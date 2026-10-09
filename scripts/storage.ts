import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { createManifest, artifact } from './load/manifest';
import {
  prepareDatabase,
  startServer,
  machine,
  ManagedServer,
} from './load/runtime';
import { runLoad } from './load/runner';
import {
  storageArguments,
  storageDatabase,
  requireFreshStorageDatabase,
  storageSnapshot,
  storageSummary,
  storageMarkdown,
  StorageSnapshot,
} from './load/storage';

/** Runs an explicitly authorized isolated cold load with endpoint storage/WAL evidence. */
export async function main(): Promise<void> {
  const settings = storageArguments(process.argv.slice(2));
  if (settings.help) {
    console.log(
      'npm run storage:measure -- --database <fresh-local-db> --confirm-exclusive-cluster [--points 2000000]\nWait for all other benchmark sessions to finish. Requires pg_ls_waldir permission. Never resets or deletes data.',
    );
    return;
  }
  if (!settings.database) throw new Error('Explicit database required');
  const url = storageDatabase(process.env, settings.database);
  const pool = await prepareDatabase(url, true);
  let server: ManagedServer | undefined;
  try {
    await requireFreshStorageDatabase(pool);
    // Permission/capability preflight must finish before any point load starts.
    await storageSnapshot(pool);
    const measuredMachine = await machine(pool);
    const directory = resolve(settings.reportDir, `storage-${randomUUID()}`);
    await mkdir(directory, { recursive: true });
    server = await startServer(url, resolve(directory, 'api.log'));
    const before = await storageSnapshot(pool);
    await artifact(resolve(directory, 'before.json'), before);
    let error: string | null = null;
    let manifestPath: string | null = null;
    let load: Awaited<ReturnType<typeof runLoad>> | null = null;
    try {
      const prepared = await createManifest(
        server.api,
        settings.points,
        directory,
      );
      manifestPath = prepared.path;
      console.log(
        JSON.stringify({
          event: 'storage_load_start',
          database: settings.database,
          points: settings.points,
          manifestPath,
        }),
      );
      load = await runLoad(pool, server, prepared.manifest, prepared.path);
    } catch (failure: unknown) {
      error = failure instanceof Error ? failure.message : String(failure);
    }
    let after: StorageSnapshot | null = null;
    let generated: string | null = null;
    let captureError: string | null = null;
    try {
      after = await storageSnapshot(pool);
      await artifact(resolve(directory, 'after.json'), after);
      const difference = (
        await pool.query<{ bytes: string }>(
          'SELECT pg_wal_lsn_diff($1::pg_lsn,$2::pg_lsn)::text AS bytes',
          [after.walInsertLsn, before.walInsertLsn],
        )
      ).rows[0];
      if (!difference) throw new Error('Missing WAL difference');
      storageSummary(before, after, difference.bytes);
      generated = difference.bytes;
    } catch (failure: unknown) {
      captureError =
        failure instanceof Error ? failure.message : String(failure);
    }
    const failure =
      [error, captureError].filter((item) => item !== null).join('; ') || null;
    const safeAfter = captureError ? null : after;
    const path = resolve(directory, 'report.json');
    const markdownPath = resolve(directory, 'REPORT.md');
    await artifact(path, {
      kind: 'storage-wal-measurement',
      measuredAt: new Date().toISOString(),
      database: settings.database,
      points: settings.points,
      exclusiveClusterConfirmedByOperator: true,
      manifestPath,
      loadReportPath: load?.path ?? null,
      before,
      after,
      summary: storageSummary(before, safeAfter, generated),
      error: failure,
      fullAssignmentScale: settings.points === 2000000,
      machine: measuredMachine,
      scope:
        'Endpoint database sizes and cluster-wide WAL; no peak measurement or per-database WAL attribution. No other workloads asserted by operator.',
    });
    await writeFile(
      markdownPath,
      storageMarkdown(before, safeAfter, generated, failure) +
        `\nRequested points: ${settings.points}. Verified final measurement rows: ${load?.report.finalDatabaseRows ?? 'unavailable'}.\n\n` +
        (load
          ? `Cold-load throughput: ${load.report.throughputNewPointsPerSecond.toFixed(2)} points/sec. Exact per-series counts/sums and aggregates verified by the existing load script. [Load evidence](${relative(directory, load.path).replaceAll('\\', '/')}).\n`
          : 'Load did not complete verification; inspect the manifest directory and error evidence.\n'),
      { flag: 'wx' },
    );
    console.log(
      JSON.stringify({
        event: 'storage_report',
        path,
        markdownPath,
        completed: failure === null,
      }),
    );
    if (failure) throw new Error(failure);
  } finally {
    try {
      await server?.stop();
    } finally {
      await pool.end();
    }
  }
}

if (require.main === module)
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });

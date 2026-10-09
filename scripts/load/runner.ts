import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { LoadManifest } from './types';
import { ApiClient } from './http';
import { workload } from './workload';
import { aggregateSnapshot, reconcile, rowCount } from './reconcile';
import { artifact } from './manifest';
import { machine, ManagedServer } from './runtime';
import { monitorRss } from './rss';

/** Confirms that a replay targets the original API-created series, not unrelated IDs. */
export async function verifyOwnership(
  pool: Pool,
  manifest: LoadManifest,
): Promise<void> {
  const result = await pool.query<{ id: string; name: string }>(
    'SELECT id::text, name FROM series WHERE id = ANY($1::bigint[])',
    [manifest.seriesIds],
  );
  if (
    result.rows.length !== 8 ||
    result.rows.some((row) => !row.name.startsWith(`load:${manifest.runId}:`))
  )
    throw new Error(
      'Manifest series do not belong to this database; refusing to write',
    );
}

/** Performs load or replay, recording actual new rows, full aggregate equality, and failures. */
export async function runLoad(
  pool: Pool,
  server: ManagedServer,
  manifest: LoadManifest,
  manifestPath: string,
) {
  await verifyOwnership(pool, manifest);
  const initialRows = await rowCount(pool, manifest);
  const mode =
    initialRows === 0
      ? 'cold'
      : initialRows === manifest.total
        ? 'replay'
        : 'resume';
  const before =
    mode === 'replay' ? await aggregateSnapshot(server.api, manifest) : null;
  const pid = server.child.pid;
  if (!pid) throw new Error('Managed API has no PID');
  const monitor = monitorRss(server.child);
  const result = await workload(server.api, manifest);
  const memory = await monitor.stop();
  const finalRows = await rowCount(pool, manifest);
  const databaseRows = await pool.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM measurements',
  );
  const path = resolve(
    dirname(manifestPath),
    `${mode}-${Date.now()}-${randomUUID()}.json`,
  );
  let accuracy: object | null = null;
  let snapshot: unknown[] | null = null;
  let error: string | null = null;
  try {
    if (
      result.completedBatches !== Math.ceil(manifest.total / manifest.batchSize)
    )
      throw new Error(
        'Not all batches completed; reuse the manifest to resume',
      );
    accuracy = await reconcile(pool, server.api, manifest);
    snapshot = await aggregateSnapshot(server.api, manifest);
    if (before && JSON.stringify(before) !== JSON.stringify(snapshot))
      throw new Error('Replay changed one or more bucket aggregates');
    const snapshotPath = resolve(
      dirname(manifestPath),
      'aggregate-snapshot.json',
    );
    try {
      const previous: unknown = JSON.parse(
        await readFile(snapshotPath, 'utf8'),
      );
      if (JSON.stringify(previous) !== JSON.stringify(snapshot))
        throw new Error('Stored baseline aggregate snapshot changed');
    } catch (failure: unknown) {
      if (
        typeof failure === 'object' &&
        failure !== null &&
        'code' in failure &&
        failure.code === 'ENOENT'
      )
        await artifact(snapshotPath, snapshot);
      else throw failure;
    }
  } catch (failure: unknown) {
    error = failure instanceof Error ? failure.message : String(failure);
  }
  const throughput = (finalRows - initialRows) / (result.wallMs / 1000);
  const evidence = result;
  const report = {
    kind: 'load',
    mode,
    runId: manifest.runId,
    manifestPath: resolve(manifestPath),
    measuredAt: new Date().toISOString(),
    machine: await machine(pool),
    settings: {
      points: manifest.total,
      batchSize: manifest.batchSize,
      writers: manifest.writers,
    },
    ...evidence,
    ...(server.cpuProfilePath
      ? {
          diagnosticOnly: true,
          cpuProfile: {
            path: server.cpuProfilePath,
            scope:
              'API process from startup through reconciliation; not load generator',
            savedAfterReport: true,
          },
        }
      : {}),
    initialRows,
    finalRows,
    finalDatabaseRows: databaseRows.rows[0]?.count,
    rowCountTargetPass:
      manifest.total === 2000000 && databaseRows.rows[0]?.count === '2000000',
    newlyStoredRows: finalRows - initialRows,
    throughputNewPointsPerSecond: throughput,
    processedInputPointsPerSecond: manifest.total / (result.wallMs / 1000),
    fullAssignmentScale: manifest.total === 2000000,
    writeTargetPass:
      mode === 'cold' &&
      manifest.total === 2000000 &&
      throughput >= 20000 &&
      error === null,
    memory,
    accuracy,
    aggregateVerification: snapshot !== null,
    replayAggregatesUnchanged: before ? error === null : null,
    errors: [...result.errors, ...(error ? [error] : [])],
    passed: error === null && result.errors.length === 0,
  };
  await artifact(path, report);
  console.log(
    JSON.stringify({
      event: 'load_report',
      mode,
      path,
      manifestPath,
      initialRows,
      finalRows,
      throughput,
    }),
  );
  if (!report.passed)
    throw new Error(`Load verification failed; inspect ${path}`);
  return { path, report };
}

/** Refuses a new cold dataset when existing measurements would invalidate the total-row target. */
export async function requireEmptyMeasurements(pool: Pool): Promise<void> {
  const existing = await pool.query('SELECT 1 FROM measurements LIMIT 1');
  if (existing.rowCount)
    throw new Error(
      'Cold load requires empty measurements in the selected database. Replay with --manifest or select a fresh local database with --database <name>; nothing was deleted.',
    );
}

/** Samples baseline HTTP reads and reports both latency and failure evidence. */
export async function idleReads(
  api: ApiClient,
  manifest: LoadManifest,
  samples: number,
): Promise<{
  latest: import('./types').RequestMetrics;
  buckets: import('./types').RequestMetrics;
}> {
  const { requestMetrics } = await import('./metrics');
  const { bucketPath } = await import('./reconcile');
  const latest = requestMetrics();
  const buckets = requestMetrics();
  for (let index = 0; index < samples; index += 1) {
    const id = manifest.seriesIds[index % manifest.seriesIds.length];
    if (!id) throw new Error('Missing benchmark series');
    for (const [path, metrics] of [
      [`/v1/series/${id}/latest`, latest],
      [bucketPath(manifest, id), buckets],
    ] as const) {
      try {
        await api.request(path, metrics, undefined, undefined, 0);
      } catch (error: unknown) {
        console.error(
          JSON.stringify({
            event: 'idle_read_failed',
            path,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }
  }
  return { latest, buckets };
}

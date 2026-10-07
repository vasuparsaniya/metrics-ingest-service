import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { isRecord } from '../src/ingest/ingest.validation';
import { options } from './load/options';
import {
  benchmarkUrl,
  machine,
  prepareDatabase,
  startServer,
} from './load/runtime';
import { artifact, readManifest } from './load/manifest';
import { idleReads, runLoad, verifyOwnership } from './load/runner';
import { reconcile, aggregateSnapshot } from './load/reconcile';
import { latency, summarize, degradation } from './load/metrics';

/** Measures full-table idle HTTP reads and replay-time concurrent reads from a saved dataset. */
export async function main(): Promise<void> {
  const settings = options();
  if (settings.help) {
    console.log(
      'npm run benchmark -- --manifest artifacts/<run>/manifest.json [--samples 100] [--database name]',
    );
    return;
  }
  if (!settings.manifest)
    throw new Error('--manifest from a completed load is required');
  const manifest = await readManifest(settings.manifest);
  const databaseUrl = benchmarkUrl(process.env, settings.database);
  const pool = await prepareDatabase(
    databaseUrl,
    settings.database !== undefined,
  );
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    await verifyOwnership(pool, manifest);
    server = await startServer(
      databaseUrl,
      resolve(settings.reportDir, `api-benchmark-${randomUUID()}.log`),
    );
    await reconcile(pool, server.api, manifest);
    await aggregateSnapshot(server.api, manifest);
    const idle = await idleReads(server.api, manifest, settings.samples);
    const replay = await runLoad(pool, server, manifest, settings.manifest);
    const coldFile = (await readdir(dirname(settings.manifest)))
      .filter((name) => name.startsWith('cold-') && name.endsWith('.json'))
      .sort()[0];
    const cold: unknown = coldFile
      ? JSON.parse(
          await readFile(resolve(dirname(settings.manifest), coldFile), 'utf8'),
        )
      : null;
    const coldP95 = (kind: 'latest' | 'buckets'): number | null => {
      if (!isRecord(cold) || !isRecord(cold.reads)) return null;
      const category = cold.reads[kind];
      if (!isRecord(category) || !isRecord(category.success)) return null;
      return typeof category.success.p95Ms === 'number'
        ? category.success.p95Ms
        : null;
    };
    const path = resolve(
      dirname(settings.manifest),
      `benchmark-${Date.now()}-${randomUUID()}.json`,
    );
    const report = {
      kind: 'benchmark',
      runId: manifest.runId,
      measuredAt: new Date().toISOString(),
      machine: await machine(pool),
      fullAssignmentScale: manifest.total === 2000000,
      idle: {
        latest: summarize(idle.latest),
        buckets: summarize(idle.buckets),
      },
      idleBucketTargetPass:
        idle.buckets.failed.length === 0 &&
        (latency(idle.buckets.success).p95Ms ?? Infinity) <= 150,
      coldLoadReport: coldFile
        ? resolve(dirname(settings.manifest), coldFile)
        : null,
      p95DegradationPercent: {
        latest: degradation(
          latency(idle.latest.success).p95Ms,
          coldP95('latest'),
        ),
        buckets: degradation(
          latency(idle.buckets.success).p95Ms,
          coldP95('buckets'),
        ),
      },
      replayReport: replay.path,
      readsDuringColdLoad:
        'Use the cold load report; replay reads are not a substitute for scenario F.',
      plans:
        'Run npm run compare -- --manifest <path> for plan and strategy evidence.',
    };
    await artifact(path, report);
    console.log(
      JSON.stringify({ event: 'benchmark_report', path, idle: report.idle }),
    );
  } finally {
    await server?.stop();
    await pool.end();
  }
}

if (require.main === module)
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });

import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { readEnvironment } from '../src/config/environment';
import {
  assertIndexHttpSchema,
  guardIndexHttpDatabase,
} from '../src/benchmark/index-http-schema';
import { createIndexHttpDatabase } from './load/index-http-schema';
import { indexHttpOptions } from './load/index-http-options';
import {
  benchmarkUrl,
  machine,
  ManagedServer,
  startServer,
} from './load/runtime';
import { artifact, createManifest } from './load/manifest';
import { workload } from './load/workload';
import { monitorRss } from './load/rss';
import { reconcile, rowCount, aggregateSnapshot } from './load/reconcile';
import {
  indexHttpBucketPlan,
  indexHttpIdleReads,
  indexHttpRoutes,
} from './load/index-http-checks';
import { generateIndexHttpReport } from './load/index-http-report';
import { VerificationReadClient } from './load/verification-read';

/** Owns one fresh schema variant and preserves failed/partial evidence without retrying writes. */
export async function main(): Promise<void> {
  const settings = indexHttpOptions();
  if (settings.help) {
    console.log(
      'npm run index:benchmark -- --variant indexed|unindexed --database metrics_index_http_<fresh_name> [--points 2000000] [--samples 100]\nCreates a fresh local experiment database; never reuses/deletes databases. Experimental plain INSERT only; no replay/resume.',
    );
    return;
  }
  const { variant, database } = settings;
  if (!variant || !database) throw new Error('Experiment selection missing');
  const environment = readEnvironment(process.env);
  const url = benchmarkUrl(process.env, database);
  guardIndexHttpDatabase(url, process.env.DATABASE_URL);
  const runId = randomUUID();
  const directory = resolve(
    settings.reportDir,
    `index-http-${variant}-${runId}`,
  );
  const path = resolve(directory, 'report.json');
  const markdownPath = resolve(directory, 'REPORT.md');
  const errors: string[] = [];
  const evidence: Record<string, unknown> = {
    kind: 'index-http-benchmark',
    variant,
    database,
    runId,
    measuredAt: new Date().toISOString(),
    settings: {
      points: settings.points,
      samples: settings.samples,
      batchSize: 5000,
      writers: 8,
      writeRetries: 0,
      foreignKey: false,
    },
    diagnosticOnly: true,
    productionAcceptance: false,
    errors,
    passed: false,
  };
  let pool: Pool | undefined;
  let server: ManagedServer | undefined;
  const attempt = async <T>(
    label: string,
    operation: () => Promise<T>,
  ): Promise<T | null> => {
    try {
      return await operation();
    } catch (failure: unknown) {
      errors.push(
        `${label}: ${failure instanceof Error ? failure.message : String(failure)}`,
      );
      return null;
    }
  };
  try {
    const created = await createIndexHttpDatabase(url, variant);
    pool = created.pool;
    evidence.schemaBefore = created.schema;
    evidence.machine = {
      ...(await machine(pool)),
      application:
        'compiled dist/benchmark/index-http-main.js; one managed Node.js process',
    };
    server = await startServer(
      url,
      resolve(directory, 'api.log'),
      undefined,
      variant,
    );
    const activeServer = server;
    const verification = new VerificationReadClient(
      activeServer.api.url,
      environment.apiToken,
    );
    evidence.verificationReads = verification.evidence;
    const { manifest, path: manifestPath } = await createManifest(
      activeServer.api,
      settings.points,
      directory,
    );
    evidence.manifestPath = manifestPath;
    console.log(
      JSON.stringify({
        event: 'index_http_start',
        variant,
        database,
        manifestPath,
        points: manifest.total,
      }),
    );
    const monitor = monitorRss(activeServer.child);
    let memory: Awaited<ReturnType<typeof monitor.stop>>;
    let load: Awaited<ReturnType<typeof workload>> | null = null;
    try {
      load = await workload(activeServer.api, manifest, { maxRetries: 0 });
      evidence.load = load;
      errors.push(...load.errors);
    } finally {
      memory = await monitor.stop();
      evidence.memory = memory;
    }
    errors.push(...memory.errors.map((error) => `RSS: ${error}`));
    if (memory.peakBytes === null)
      errors.push('RSS: no API memory samples recorded');
    const finalRows = await rowCount(pool, manifest);
    evidence.finalRows = finalRows;
    if (
      !load ||
      finalRows !== manifest.total ||
      load.returnedAccepted !== manifest.total ||
      load.returnedDuplicates !== 0 ||
      load.completedBatches !== Math.ceil(manifest.total / manifest.batchSize)
    )
      errors.push(
        'Write count/response mismatch; partial run is not comparable',
      );
    evidence.throughputNewPointsPerSecond = load
      ? finalRows / (load.wallMs / 1000)
      : null;
    const accuracy = await attempt('Count/sum reconciliation', () =>
      reconcile(created.pool, verification, manifest),
    );
    evidence.accuracy = accuracy;
    evidence.writeMeasurementValid =
      load !== null &&
      accuracy !== null &&
      finalRows === manifest.total &&
      load.returnedAccepted === manifest.total &&
      load.returnedDuplicates === 0 &&
      load.completedBatches ===
        Math.ceil(manifest.total / manifest.batchSize) &&
      !load.errors.some((error) => error.startsWith('writer '));
    const routes = await indexHttpRoutes(activeServer.api, manifest);
    evidence.routes = routes;
    if (!routes.passed) errors.push('One or more existing route checks failed');
    const aggregates = await attempt('Hourly aggregate verification', () =>
      aggregateSnapshot(verification, manifest),
    );
    evidence.aggregateVerification = aggregates === null ? false : true;
    if (aggregates !== null)
      await artifact(resolve(directory, 'aggregate-snapshot.json'), aggregates);
    const idle = await indexHttpIdleReads(
      activeServer.api,
      manifest,
      settings.samples,
    );
    evidence.idle = idle;
    for (const [kind, result] of Object.entries(idle))
      if (result.error)
        errors.push(
          `Idle ${kind}: ${result.error}; sampling stopped at ${result.attempted}/${result.requested}`,
        );
    const plan = await indexHttpBucketPlan(pool, manifest);
    evidence.bucketPlan = plan;
    if (!plan.passed) errors.push(`Bucket EXPLAIN: ${plan.error}`);
    evidence.schemaAfter = await assertIndexHttpSchema(pool, variant);
  } catch (failure: unknown) {
    errors.push(failure instanceof Error ? failure.message : String(failure));
  } finally {
    const ownedServer = server;
    const ownedPool = pool;
    if (ownedServer) await attempt('API cleanup', () => ownedServer.stop());
    if (ownedPool)
      await attempt('Database connection cleanup', () => ownedPool.end());
  }
  evidence.writeMeasurementValid =
    evidence.writeMeasurementValid === true &&
    evidence.schemaAfter !== undefined;
  evidence.passed = errors.length === 0 && evidence.schemaAfter !== undefined;
  await artifact(path, evidence);
  await generateIndexHttpReport(path);
  console.log(
    JSON.stringify({
      event: 'index_http_report',
      variant,
      database,
      path,
      markdownPath,
      passed: evidence.passed,
    }),
  );
  if (!evidence.passed)
    throw new Error(`Index HTTP experiment failed; inspect ${markdownPath}`);
}

if (require.main === module)
  void main().catch((failure: unknown) => {
    console.error(failure instanceof Error ? failure.message : String(failure));
    process.exitCode = 1;
  });

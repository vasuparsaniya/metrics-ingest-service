import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { options } from './load/options';
import { benchmarkUrl, prepareDatabase, startServer } from './load/runtime';
import { artifact, createManifest, readManifest } from './load/manifest';
import { idleReads, requireEmptyMeasurements, runLoad } from './load/runner';
import { summarize, latency, degradation } from './load/metrics';
import { terminationSemantics } from './load/rss';
import { generateAcceptanceReport } from './load/report';
import {
  concurrentScenario,
  partialScenario,
  lateScenario,
  restartScenario,
} from './load/scenarios';

/** Runs PDF scenarios A–G, keeping case and restart data outside A's exact-count database. */
export async function main(): Promise<void> {
  const settings = options();
  if (settings.help) {
    console.log(
      'npm run acceptance -- [--points 2000000] [--database name] [--manifest path] [--samples 100]\nUses DATABASE_URL by default; creates local isolated case/restart databases, never clears existing data.',
    );
    return;
  }
  const databaseUrl = benchmarkUrl(process.env, settings.database);
  const pool = await prepareDatabase(
    databaseUrl,
    settings.database !== undefined,
  );
  const runId = randomUUID();
  const directory = resolve(settings.reportDir, `acceptance-${runId}`);
  const reportPath = resolve(directory, 'acceptance.json');
  let markdownPath: string | undefined;
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  let caseServer: Awaited<ReturnType<typeof startServer>> | undefined;
  let casePool: Pool | undefined;
  let restartPool: Pool | undefined;
  const results: Record<string, unknown> = {};
  let failure: string | null = null;
  try {
    if (!settings.manifest) await requireEmptyMeasurements(pool);
    server = await startServer(databaseUrl, resolve(directory, 'api-load.log'));
    const prepared = settings.manifest
      ? {
          manifest: await readManifest(settings.manifest),
          path: settings.manifest,
        }
      : await createManifest(server.api, settings.points, directory);
    console.log(
      JSON.stringify({
        event: 'acceptance_start',
        manifestPath: prepared.path,
        total: prepared.manifest.total,
      }),
    );
    const loaded = await runLoad(
      pool,
      server,
      prepared.manifest,
      prepared.path,
    );
    results.A = loaded;
    results.B = await runLoad(pool, server, prepared.manifest, prepared.path);
    const idle = await idleReads(
      server.api,
      prepared.manifest,
      settings.samples,
    );
    results.F = {
      coldReadEvidence: loaded.path,
      note: settings.manifest
        ? 'Existing dataset: A may be a replay; refer to its original cold report for scenario F.'
        : 'A report records reads while fresh writes are active.',
      idle: {
        latest: summarize(idle.latest),
        buckets: summarize(idle.buckets),
      },
      p95DegradationPercent: {
        latest: degradation(
          latency(idle.latest.success).p95Ms,
          loaded.report.reads.latest.success.p95Ms,
        ),
        buckets: degradation(
          latency(idle.buckets.success).p95Ms,
          loaded.report.reads.buckets.success.p95Ms,
        ),
      },
    };
    await server.stop();
    server = undefined;
    const casesUrl = new URL(databaseUrl);
    casesUrl.pathname = `/metrics_benchmark_cases_${runId.replace(/-/g, '')}`;
    casePool = await prepareDatabase(casesUrl.toString(), true);
    caseServer = await startServer(
      casesUrl.toString(),
      resolve(directory, 'api-cases.log'),
    );
    results.C = await concurrentScenario(casePool, caseServer.api);
    results.D = await partialScenario(casePool, caseServer.api);
    results.E = await lateScenario(caseServer.api);
    await caseServer.stop();
    caseServer = undefined;
    const restartUrl = new URL(databaseUrl);
    restartUrl.pathname = `/metrics_benchmark_restart_${runId.replace(/-/g, '')}`;
    restartPool = await prepareDatabase(restartUrl.toString(), true);
    results.G = await restartScenario(
      restartPool,
      restartUrl.toString(),
      prepared.manifest.total,
      directory,
    );
  } catch (error: unknown) {
    failure = error instanceof Error ? error.message : String(error);
  } finally {
    await server?.stop();
    await caseServer?.stop();
    await pool.end();
    await casePool?.end();
    await restartPool?.end();
    await artifact(reportPath, {
      kind: 'acceptance',
      runId,
      database: new URL(databaseUrl).pathname.slice(1),
      measuredAt: new Date().toISOString(),
      termination: terminationSemantics(),
      results,
      passed: failure === null,
      error: failure,
      retainedDatabases:
        'Primary, cases, and restart databases are retained; no data was deleted.',
    });
    markdownPath = await generateAcceptanceReport(reportPath);
  }
  console.log(
    JSON.stringify({
      event: 'acceptance_report',
      path: reportPath,
      markdownPath,
      passed: failure === null,
    }),
  );
  if (failure) throw new Error(failure);
}

if (require.main === module)
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });

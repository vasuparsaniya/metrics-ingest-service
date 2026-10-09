import { randomUUID } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { Pool, PoolClient } from 'pg';
import { isRecord } from '../../src/ingest/ingest.validation';
import { ApiClient, ingestResult } from './http';
import { requestMetrics, summarize } from './metrics';
import { GeneratedPoint } from './types';
import { batchAt, batchKey } from './generator';
import { artifact, createManifest } from './manifest';
import { startServer } from './runtime';
import { monitorRss, terminationSemantics } from './rss';
import { workload } from './workload';
import { rowCount } from './reconcile';
import { runLoad } from './runner';
import {
  InsertActivity,
  RestartScenarioError,
  waitForTargetLock,
} from './restart-observer';
import { postgresSessionOptions } from '../../src/database/session-options';

async function series(api: ApiClient, label: string): Promise<string> {
  const created = await api.request('/v1/series', requestMetrics(), {
    name: `scenario:${label}:${randomUUID()}`,
  });
  if (!isRecord(created) || typeof created.seriesId !== 'string')
    throw new Error('Invalid scenario series');
  return created.seriesId;
}

function points(id: string): GeneratedPoint[] {
  return Array.from({ length: 5000 }, (_, index) => ({
    seriesId: id,
    ts: new Date(
      Date.parse('2026-10-01T00:00:00Z') + index * 1000,
    ).toISOString(),
    value: '1.25',
  }));
}

async function count(pool: Pool, id: string): Promise<number> {
  const result = await pool.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM measurements WHERE series_id = $1',
    [id],
  );
  return Number(result.rows[0]?.count);
}

/** Exercises same-key coordination and point-level concurrent duplicates without retry hiding. */
export async function concurrentScenario(
  pool: Pool,
  api: ApiClient,
): Promise<object> {
  const id = await series(api, 'C');
  const body = { points: points(id) };
  const key = `scenario:C:${randomUUID()}`;
  const metrics = requestMetrics();
  const original = await Promise.all([
    api.request('/v1/ingest', metrics, body, key, 0),
    api.request('/v1/ingest', metrics, body, key, 0),
  ]);
  const first = ingestResult(original[0]);
  const second = ingestResult(original[1]);
  if (
    first.accepted !== 5000 ||
    JSON.stringify(first) !== JSON.stringify(second) ||
    (await count(pool, id)) !== 5000
  )
    throw new Error('Concurrent same-key scenario failed');
  const pointRaceId = await series(api, 'C-point-race');
  const racePoints = points(pointRaceId);
  const replays = await Promise.all([
    api.request('/v1/ingest', metrics, { points: racePoints }, `${key}:a`, 0),
    api.request(
      '/v1/ingest',
      metrics,
      { points: [...racePoints].reverse() },
      `${key}:b`,
      0,
    ),
  ]);
  if (
    replays.reduce<number>(
      (sum, result) => sum + ingestResult(result).accepted,
      0,
    ) !== 5000 ||
    replays.reduce<number>(
      (sum, result) => sum + ingestResult(result).duplicates,
      0,
    ) !== 5000 ||
    replays.some((result) => ingestResult(result).rejected.length !== 0) ||
    (await count(pool, pointRaceId)) !== 5000
  )
    throw new Error('Concurrent different-key duplicate scenario failed');
  return {
    passed: true,
    seriesId: id,
    rows: 5000,
    pointRaceSeriesId: pointRaceId,
    requests: summarize(metrics),
    trap: 'Repeated identities can make ON CONFLICT DO UPDATE affect one row twice; pre-deduplicate. Sort identities before locks to avoid reversed-batch deadlocks.',
  };
}

/** Submits exactly 5000 inputs and verifies rejected indexes plus surviving row count. */
export async function partialScenario(
  pool: Pool,
  api: ApiClient,
): Promise<object> {
  const id = await series(api, 'D');
  const batch: unknown[] = points(id);
  batch[4] = {
    seriesId: id,
    ts: '2026-10-01T00:00:04Z',
    value: 'not-a-number',
  };
  batch[5] = { seriesId: id, ts: 'not-a-timestamp', value: '1.25' };
  batch[6] = {
    seriesId: '9223372036854775807',
    ts: '2026-10-01T00:00:06Z',
    value: '1.25',
  };
  batch[4999] = batch[0];
  const metrics = requestMetrics();
  const result = ingestResult(
    await api.request(
      '/v1/ingest',
      metrics,
      { points: batch },
      `scenario:D:${randomUUID()}`,
    ),
  );
  if (
    result.accepted !== 4996 ||
    result.duplicates !== 1 ||
    JSON.stringify(result.rejected.map((row) => row.index)) !== '[4,5,6]' ||
    (await count(pool, id)) !== 4996
  )
    throw new Error('Partial failure scenario failed');
  return {
    passed: true,
    seriesId: id,
    response: result,
    requests: summarize(metrics),
  };
}

/** Verifies previously queried buckets change while latest remains the newest timestamp. */
export async function lateScenario(api: ApiClient): Promise<object> {
  const id = await series(api, 'E');
  const metrics = requestMetrics();
  const path = `/v1/series/${id}/points?from=2026-10-01T09:00:00Z&to=2026-10-01T11:00:00Z&bucket=1h`;
  await api.request(
    '/v1/ingest',
    metrics,
    { points: [{ seriesId: id, ts: '2026-10-01T10:30:00Z', value: '20' }] },
    `scenario:E:new:${randomUUID()}`,
  );
  const before = await api.request(path, metrics);
  await api.request(
    '/v1/ingest',
    metrics,
    {
      points: [
        { seriesId: id, ts: '2026-10-01T10:05:00Z', value: '3' },
        { seriesId: id, ts: '2026-10-01T09:59:00Z', value: '4' },
      ],
    },
    `scenario:E:old:${randomUUID()}`,
  );
  const after = await api.request(path, metrics);
  const latest = await api.request(`/v1/series/${id}/latest`, metrics);
  if (
    !Array.isArray(after) ||
    !isRecord(after[0]) ||
    !isRecord(after[1]) ||
    after[0].sum !== '4' ||
    after[1].sum !== '23' ||
    !isRecord(latest) ||
    latest.value !== '20'
  )
    throw new Error('Late-arrival scenario failed');
  return { passed: true, seriesId: id, before, after, latest };
}

/** Interrupts an actual in-flight batch during a full writer load, then restarts and replays. */
export async function restartScenario(
  pool: Pool,
  databaseUrl: string,
  total: number,
  directory: string,
): Promise<object> {
  let server = await startServer(
    databaseUrl,
    resolve(directory, `restart-before-${randomUUID()}.log`),
  );
  let blocker: PoolClient | undefined;
  let partial: ReturnType<typeof workload> | undefined;
  let rss: ReturnType<typeof monitorRss> | undefined;
  let terminate = false;
  let workloadEnded = false;
  let observer: Pool | undefined;
  let observerClient: PoolClient | undefined;
  let blockerPid: number | undefined;
  let observation: Awaited<ReturnType<typeof waitForTargetLock>> | undefined;
  let lastActivity: InsertActivity[] = [];
  let polls = 0;
  let manifestPath: string | undefined;
  let stage = 'prepare';
  try {
    const prepared = await createManifest(server.api, total, directory);
    const manifest = prepared.manifest;
    manifestPath = prepared.path;
    const firstBatch = batchAt(manifest, 0);
    // Block the final identity in lock order so preceding rows execute before SIGTERM.
    const ordered = [...firstBatch].sort(
      (a, b) =>
        Number(BigInt(a.seriesId) - BigInt(b.seriesId)) ||
        a.ts.localeCompare(b.ts),
    );
    const last = ordered[ordered.length - 1];
    if (!last) throw new Error('Restart needs a nonempty batch');
    blocker = await pool.connect();
    const backend = await blocker.query<{ pid: number }>(
      'SELECT pg_backend_pid() AS pid',
    );
    blockerPid = backend.rows[0]?.pid;
    if (!blockerPid) throw new Error('Missing restart blocker backend PID');
    await blocker.query('BEGIN');
    await blocker.query(
      'INSERT INTO measurements(series_id, ts, value) VALUES ($1,$2,$3)',
      [last.seriesId, last.ts, last.value],
    );
    const pid = server.child.pid;
    if (!pid) throw new Error('No restart process PID');
    // Establish the observer before CPU-heavy generation and API validation begin.
    observer = new Pool({
      connectionString: databaseUrl,
      max: 1,
      connectionTimeoutMillis: 2000,
      statement_timeout: 1000,
      options: postgresSessionOptions,
    });
    observerClient = await observer.connect();
    await observerClient.query('SELECT 1');
    rss = monitorRss(server.child);
    partial = workload(server.api, manifest, {
      shouldStop: () => terminate,
      reads: true,
    }).finally(() => {
      workloadEnded = true;
    });
    stage = 'lock-observation';
    const observing = observerClient;
    observation = await waitForTargetLock({
      blockerPid,
      ended: () => workloadEnded,
      read: async () => {
        const waiting = await observing.query<InsertActivity>(`SELECT pid,
          wait_event_type AS "waitEventType", pg_blocking_pids(pid) AS "blockerPids"
          FROM pg_stat_activity WHERE datname = current_database()
          AND application_name = 'metrics-ingest-service'
          AND query LIKE '%INSERT INTO measurements%'`);
        lastActivity = waiting.rows;
        polls += 1;
        return waiting.rows;
      },
    });
    terminate = true;
    stage = 'termination';
    await server.stop();
    if (server.forcedKill)
      throw new Error(
        'API needed forced SIGKILL; SIGTERM scenario did not pass',
      );
    const interrupted = await partial;
    partial = undefined;
    const memoryBeforeRestart = await rss.stop();
    rss = undefined;
    await blocker.query('ROLLBACK');
    blocker.release();
    blocker = undefined;
    stage = 'rollback-verification';
    const batchRows = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM measurements m
      JOIN unnest($1::bigint[], $2::timestamptz[]) AS p(id, ts) ON m.series_id = p.id AND m.ts = p.ts`,
      [firstBatch.map((p) => p.seriesId), firstBatch.map((p) => p.ts)],
    );
    const request = await pool.query(
      'SELECT 1 FROM ingest_requests WHERE idempotency_key = $1',
      [batchKey(manifest, 0)],
    );
    if (batchRows.rows[0]?.count !== '0' || request.rowCount !== 0)
      throw new Error('Interrupted batch left rows or a cached request');
    const rowsAfterInterruption = await rowCount(pool, manifest);
    const interruptedReport = resolve(
      dirname(prepared.path),
      'interrupted.json',
    );
    await artifact(interruptedReport, {
      observedMidBatchLock: true,
      blockerPid,
      observation,
      termination: terminationSemantics(),
      rowsAfterInterruption,
      memory: memoryBeforeRestart,
      interrupted,
      halfWrittenTargetBatchRows: 0,
      targetRequestPersisted: false,
    });
    server = await startServer(
      databaseUrl,
      resolve(directory, `restart-after-${randomUUID()}.log`),
    );
    stage = 'resume';
    const resumed = await runLoad(pool, server, manifest, prepared.path);
    stage = 'replay';
    const replayed = await runLoad(pool, server, manifest, prepared.path);
    return {
      passed: true,
      termination: terminationSemantics(),
      total,
      fullAssignmentScale: total === 2000000,
      manifestPath: prepared.path,
      interruptedReport,
      observation,
      blockerPid,
      rowsAfterInterruption,
      resumedReport: resumed.path,
      replayReport: replayed.path,
    };
  } catch (error: unknown) {
    terminate = true;
    await server.stop();
    const interrupted = partial ? await partial : undefined;
    partial = undefined;
    const failureReport = resolve(
      directory,
      `restart-failure-${randomUUID()}.json`,
    );
    const message = error instanceof Error ? error.message : String(error);
    await artifact(failureReport, {
      kind: 'restart-failure',
      passed: false,
      stage,
      error: message,
      manifestPath,
      blockerPid,
      observation,
      polls,
      lastActivity,
      interrupted,
      observationTimeoutMs: 10000,
      productionLockTimeoutMs: 2000,
    });
    throw new RestartScenarioError(message, failureReport, error);
  } finally {
    terminate = true;
    await server.stop();
    await rss?.stop();
    if (partial) await partial;
    if (blocker) {
      try {
        await blocker.query('ROLLBACK');
      } finally {
        blocker.release();
      }
    }
    observerClient?.release();
    await observer?.end();
  }
}

import { performance } from 'node:perf_hooks';
import { Pool } from 'pg';
import { bucketSql } from '../../src/queries/bucket.sql';
import { isRecord } from '../../src/ingest/ingest.validation';
import { decimal } from '../../src/validation/numeric';
import { ApiClient } from './http';
import { pointAt } from './generator';
import { requestMetrics, summarize } from './metrics';
import { bucketPath } from './reconcile';
import { LoadManifest } from './types';

/** Bounds failed index-free sampling without claiming skipped requests succeeded. */
export async function indexHttpIdleReads(
  api: ApiClient,
  manifest: LoadManifest,
  samples: number,
) {
  const read = async (kind: 'latest' | 'buckets') => {
    const metrics = requestMetrics();
    let attempted = 0;
    let error: string | null = null;
    for (let index = 0; index < samples; index++) {
      const id = manifest.seriesIds[index % manifest.seriesIds.length];
      if (!id) throw new Error('Missing experiment series');
      attempted++;
      try {
        await api.request(
          kind === 'latest'
            ? `/v1/series/${id}/latest`
            : bucketPath(manifest, id),
          metrics,
          undefined,
          undefined,
          0,
        );
      } catch (failure: unknown) {
        error = failure instanceof Error ? failure.message : String(failure);
        break;
      }
    }
    return { ...summarize(metrics), requested: samples, attempted, error };
  };
  return { latest: await read('latest'), buckets: await read('buckets') };
}

/** Checks reused routes without introducing writes or conflating liveness with readiness. */
export async function indexHttpRoutes(api: ApiClient, manifest: LoadManifest) {
  const checks: { route: string; passed: boolean; error: string | null }[] = [];
  const check = async (route: string, verify: (value: unknown) => void) => {
    try {
      const response = await api.request(
        route,
        requestMetrics(),
        undefined,
        undefined,
        0,
      );
      verify(response);
      checks.push({ route, passed: true, error: null });
    } catch (failure: unknown) {
      checks.push({
        route,
        passed: false,
        error: failure instanceof Error ? failure.message : String(failure),
      });
    }
  };
  for (const route of ['/healthz', '/readyz'])
    await check(route, (value) => {
      if (
        !isRecord(value) ||
        value.status !== (route === '/readyz' ? 'ready' : 'ok')
      )
        throw new Error('Invalid health response');
    });
  await check('/v1/stats', (value) => {
    if (
      !isRecord(value) ||
      String(value.totalMeasurements) !== String(manifest.total) ||
      String(value.totalSeries) !== '8'
    )
      throw new Error('Stats totals do not match the generated dataset');
  });
  for (const [index, id] of manifest.seriesIds.entries()) {
    const lastIndex = index + Math.floor((manifest.total - 1 - index) / 8) * 8;
    const expected = pointAt(manifest, lastIndex);
    await check(`/v1/series/${id}/latest`, (value) => {
      if (
        !isRecord(value) ||
        value.seriesId !== expected.seriesId ||
        typeof value.ts !== 'string' ||
        Date.parse(value.ts) !== Date.parse(expected.ts) ||
        decimal(value.value) !== decimal(expected.value)
      )
        throw new Error(
          'Latest response does not match the generated last point',
        );
    });
  }
  return {
    passed: checks.every((check) => check.passed),
    checks,
    otherRoutes:
      'Series creation and ingest checked by manifest/load; bucket correctness checked separately against generated aggregates.',
  };
}

/** Captures real bucket execution or an explicit timeout, never an estimated/fabricated plan. */
export async function indexHttpBucketPlan(pool: Pool, manifest: LoadManifest) {
  const id = manifest.seriesIds[0];
  if (!id) throw new Error('Missing experiment series');
  const client = await pool.connect();
  const started = performance.now();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '30000'");
    try {
      const result = await client.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN (ANALYZE, BUFFERS) ${bucketSql}`,
        [id, manifest.from, manifest.to, 'hour', '1 hour'],
      );
      return {
        passed: true,
        wallMs: performance.now() - started,
        output: result.rows.map((row) => row['QUERY PLAN']).join('\n'),
        error: null,
      };
    } catch (failure: unknown) {
      return {
        passed: false,
        wallMs: performance.now() - started,
        output: null,
        error: failure instanceof Error ? failure.message : String(failure),
      };
    } finally {
      await client.query('ROLLBACK');
    }
  } finally {
    client.release();
  }
}

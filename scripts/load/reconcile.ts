import { Pool } from 'pg';
import { isRecord } from '../../src/ingest/ingest.validation';
import { decimal } from '../../src/validation/numeric';
import { LoadManifest } from './types';
import { pointAt, centsText } from './generator';
import { ApiClient } from './http';
import { requestMetrics } from './metrics';

/** Reads the actual manifest-owned row count, not cached accepted response counts. */
export async function rowCount(
  pool: Pool,
  manifest: LoadManifest,
): Promise<number> {
  const result = await pool.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM measurements WHERE series_id = ANY($1::bigint[])',
    [manifest.seriesIds],
  );
  return Number(result.rows[0]?.count ?? '0');
}

/** Independently verifies database count/sum and the HTTP stats contract. */
export async function reconcile(
  pool: Pool,
  api: ApiClient,
  manifest: LoadManifest,
): Promise<object> {
  const stored = await pool.query<{
    seriesId: string;
    count: string;
    sum: string | null;
  }>(
    `
    SELECT s.id::text AS "seriesId", count(m.series_id)::text AS count, sum(m.value)::text AS sum
    FROM series s LEFT JOIN measurements m ON m.series_id = s.id
    WHERE s.id = ANY($1::bigint[]) GROUP BY s.id ORDER BY s.id`,
    [manifest.seriesIds],
  );
  for (const expected of manifest.expected) {
    const actual = stored.rows.find(
      (row) => row.seriesId === expected.seriesId,
    );
    if (
      !actual ||
      Number(actual.count) !== expected.count ||
      actual.sum === null ||
      decimal(actual.sum) !== decimal(expected.sum)
    )
      throw new Error(
        `Count/sum reconciliation failed for series ${expected.seriesId}`,
      );
  }
  const stats = await api.request('/v1/stats', requestMetrics());
  if (!isRecord(stats) || !Array.isArray(stats.series))
    throw new Error('Invalid stats response');
  for (const expected of manifest.expected) {
    const entry = (stats.series as unknown[]).find(
      (row) => isRecord(row) && row.seriesId === expected.seriesId,
    );
    if (!isRecord(entry) || String(entry.count) !== String(expected.count))
      throw new Error(
        `HTTP stats reconciliation failed for series ${expected.seriesId}`,
      );
  }
  const all = await pool.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM measurements',
  );
  return {
    passed: true,
    manifestRows: manifest.total,
    databaseTotalRows: all.rows[0]?.count,
    perSeries: stored.rows,
    expected: manifest.expected,
  };
}

/** Constructs the thirty-day hourly query used consistently by load and benchmark readers. */
export function bucketPath(manifest: LoadManifest, seriesId: string): string {
  return `/v1/series/${seriesId}/points?${new URLSearchParams({ from: manifest.from, to: manifest.to, bucket: '1h' })}`;
}

interface ExpectedBucket {
  count: number;
  sum: bigint;
  min: bigint | null;
  max: bigint | null;
  last: { ts: string; value: string } | null;
}

function exactAverage(value: unknown, expected: ExpectedBucket): boolean {
  if (typeof value !== 'string') return false;
  const normalized = decimal(value);
  const negative = normalized.startsWith('-');
  const [integer = '', fraction = ''] = normalized.replace(/^-/, '').split('.');
  const scale = 10n ** BigInt(fraction.length);
  const units = BigInt(integer + fraction) * (negative ? -1n : 1n);
  const difference =
    units * BigInt(expected.count) * 100n - expected.sum * scale;
  const magnitude = difference < 0n ? -difference : difference;
  // PostgreSQL NUMERIC's finite division contract is checked within one last-place unit.
  return (
    magnitude === 0n ||
    (scale >= 1000000000000n && magnitude <= BigInt(expected.count) * 100n)
  );
}

/** Checks every hourly aggregate against independent fixed-scale generated expectations. */
export async function aggregateSnapshot(
  api: ApiClient,
  manifest: LoadManifest,
): Promise<unknown[]> {
  const hours = (Date.parse(manifest.to) - Date.parse(manifest.from)) / 3600000;
  const expected = new Map(
    manifest.seriesIds.map((id) => [
      id,
      Array.from({ length: hours }, (): ExpectedBucket => ({
        count: 0,
        sum: 0n,
        min: null,
        max: null,
        last: null,
      })),
    ]),
  );
  for (let index = 0; index < manifest.total; index += 1) {
    const point = pointAt(manifest, index);
    const slot = Math.floor(
      (Date.parse(point.ts) - Date.parse(manifest.from)) / 3600000,
    );
    const bucket = expected.get(point.seriesId)?.[slot];
    if (!bucket) throw new Error('Generated point is outside expected buckets');
    const cents = BigInt((index % 2001) - 1000);
    bucket.count += 1;
    bucket.sum += cents;
    bucket.min = bucket.min === null || cents < bucket.min ? cents : bucket.min;
    bucket.max = bucket.max === null || cents > bucket.max ? cents : bucket.max;
    bucket.last = { ts: point.ts, value: point.value };
  }
  const snapshots: unknown[] = [];
  for (const id of manifest.seriesIds) {
    const actual = await api.request(
      bucketPath(manifest, id),
      requestMetrics(),
    );
    if (!Array.isArray(actual) || actual.length !== hours)
      throw new Error(`Wrong number of hourly buckets for series ${id}`);
    for (let slot = 0; slot < hours; slot += 1) {
      const row: unknown = actual[slot];
      const target = expected.get(id)?.[slot];
      if (
        !isRecord(row) ||
        !target ||
        typeof row.bucketStart !== 'string' ||
        Date.parse(row.bucketStart) !==
          Date.parse(manifest.from) + slot * 3600000 ||
        String(row.count) !== String(target.count)
      )
        throw new Error(`Bucket count/start mismatch: ${id}/${slot}`);
      if (target.count === 0) {
        if (
          [row.sum, row.min, row.max, row.avg, row.last].some(
            (value) => value !== null,
          )
        )
          throw new Error(`Empty bucket invented a value: ${id}/${slot}`);
      } else {
        for (const [field, cents] of [
          ['sum', target.sum],
          ['min', target.min],
          ['max', target.max],
        ] as const) {
          if (
            cents === null ||
            decimal(row[field]) !== decimal(centsText(cents))
          )
            throw new Error(`Bucket ${field} mismatch: ${id}/${slot}`);
        }
        if (
          !exactAverage(row.avg, target) ||
          !isRecord(row.last) ||
          !target.last ||
          typeof row.last.ts !== 'string' ||
          Date.parse(row.last.ts) !== Date.parse(target.last.ts) ||
          decimal(row.last.value) !== decimal(target.last.value)
        )
          throw new Error(`Bucket avg/last mismatch: ${id}/${slot}`);
      }
    }
    snapshots.push({ seriesId: id, buckets: actual });
  }
  return snapshots;
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { exactCount } from '../validation/numeric';
import { utcSql } from '../validation/timestamp';
import { BucketQuery } from './query.validation';

/** An exact-value point returned without timestamp or decimal precision loss. */
export interface PointResponse {
  seriesId: string;
  ts: string;
  value: string;
}

/** SQL-generated summary of one UTC bucket, including explicit empty results. */
export interface BucketResponse {
  bucketStart: string;
  count: number | string;
  sum: string | null;
  min: string | null;
  max: string | null;
  avg: string | null;
  last: { ts: string; value: string } | null;
}

interface BucketRow {
  bucketStart: string;
  count: string;
  sum: string | null;
  min: string | null;
  max: string | null;
  avg: string | null;
  lastTs: string | null;
  lastValue: string | null;
}

/** Computes aggregates in PostgreSQL using the composite identity index for point lookups. */
@Injectable()
export class QueriesRepository {
  constructor(private readonly database: DatabaseService) {}

  async latest(id: string): Promise<PointResponse | null> {
    const result = await this.database.pool.query<{
      seriesId: string;
      ts: string | null;
      value: string | null;
    }>(
      `
      SELECT s.id::text AS "seriesId", ${utcSql('p.ts')} AS ts, p.value::text AS value
      FROM series s LEFT JOIN LATERAL (
        SELECT ts, value FROM measurements WHERE series_id = s.id ORDER BY ts DESC LIMIT 1
      ) p ON true WHERE s.id = $1::bigint`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException('Series does not exist');
    if (row.ts === null || row.value === null) return null;
    return { seriesId: row.seriesId, ts: row.ts, value: row.value };
  }

  async buckets(query: BucketQuery): Promise<BucketResponse[]> {
    const exists = await this.database.pool.query(
      'SELECT id FROM series WHERE id = $1::bigint',
      [query.id],
    );
    if (exists.rowCount === 0)
      throw new NotFoundException('Series does not exist');
    const result = await this.database.pool.query<BucketRow>(
      `
      WITH aggregates AS (
        SELECT date_trunc($4::text, ts, 'UTC') AS bucket,
          count(*) AS count, sum(value) AS sum, min(value) AS min, max(value) AS max, avg(value) AS avg
        FROM measurements
        WHERE series_id = $1::bigint AND ts >= $2::timestamptz AND ts < $3::timestamptz
        GROUP BY 1
      ), bounds AS (
        SELECT date_trunc($4::text, $2::timestamptz, 'UTC') AS first_bucket,
          date_trunc($4::text, $3::timestamptz - interval '1 microsecond', 'UTC') AS final_bucket
      ), buckets AS (
        SELECT first_bucket + step * $5::interval AS bucket
        FROM bounds CROSS JOIN LATERAL generate_series(0::bigint,
          (extract(epoch FROM final_bucket - first_bucket) / extract(epoch FROM $5::interval))::bigint) AS steps(step)
      )
      SELECT ${utcSql('b.bucket')} AS "bucketStart", coalesce(a.count, 0)::text AS count,
        a.sum::text AS sum, a.min::text AS min, a.max::text AS max, a.avg::text AS avg,
        ${utcSql('last_point.ts')} AS "lastTs", last_point.value::text AS "lastValue"
      FROM buckets b LEFT JOIN aggregates a ON a.bucket = b.bucket
      LEFT JOIN LATERAL (
        SELECT ts, value FROM measurements
        WHERE a.count > 0 AND series_id = $1::bigint
          AND ts >= greatest(b.bucket, $2::timestamptz)
          AND ts < CASE WHEN b.bucket = date_trunc($4::text, $3::timestamptz - interval '1 microsecond', 'UTC')
            THEN $3::timestamptz ELSE b.bucket + $5::interval END
        ORDER BY ts DESC LIMIT 1
      ) last_point ON true
      ORDER BY b.bucket`,
      [query.id, query.from, query.to, query.unit, query.interval],
    );
    return result.rows.map((row) => ({
      bucketStart: row.bucketStart,
      count: exactCount(row.count),
      sum: row.sum,
      min: row.min,
      max: row.max,
      avg: row.avg,
      last:
        row.lastTs === null || row.lastValue === null
          ? null
          : { ts: row.lastTs, value: row.lastValue },
    }));
  }
}

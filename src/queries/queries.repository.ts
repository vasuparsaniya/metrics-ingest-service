import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { exactCount } from '../validation/numeric';
import { utcSql } from '../validation/timestamp';
import { BucketQuery } from './query.validation';
import { bucketSql } from './bucket.sql';

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
    const result = await this.database.pool.query<BucketRow>(bucketSql, [
      query.id,
      query.from,
      query.to,
      query.unit,
      query.interval,
    ]);
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

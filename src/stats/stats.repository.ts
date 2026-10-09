import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { exactCount } from '../validation/numeric';
import { utcSql } from '../validation/timestamp';

/** Exact row counts and timestamp bounds; coverage does not imply continuous data. */
export interface StatsResponse {
  totalSeries: number | string;
  totalMeasurements: number | string;
  series: {
    seriesId: string;
    name: string;
    count: number | string;
    from: string | null;
    to: string | null;
  }[];
}

/** Reads totals and per-series coverage in one database snapshot. */
@Injectable()
export class StatsRepository {
  constructor(private readonly database: DatabaseService) {}

  async stats(): Promise<StatsResponse> {
    const result = await this.database.pool.query<{
      seriesId: string;
      name: string;
      count: string;
      from: string | null;
      to: string | null;
      totalSeries: string;
      totalMeasurements: string;
    }>(`
      WITH counts AS (
        SELECT s.id, s.name, count(m.series_id) AS count, min(m.ts) AS first, max(m.ts) AS last
        FROM series s LEFT JOIN measurements m ON m.series_id = s.id GROUP BY s.id
      )
      SELECT id::text AS "seriesId", name, count::text,
        ${utcSql('first')} AS "from", ${utcSql('last')} AS "to",
        count(*) OVER ()::text AS "totalSeries", sum(count) OVER ()::text AS "totalMeasurements"
      FROM counts ORDER BY id`);
    const first = result.rows[0];
    return {
      totalSeries: exactCount(first?.totalSeries ?? '0'),
      totalMeasurements: exactCount(first?.totalMeasurements ?? '0'),
      series: result.rows.map((row) => ({
        seriesId: row.seriesId,
        name: row.name,
        count: exactCount(row.count),
        from: row.from,
        to: row.to,
      })),
    };
  }
}

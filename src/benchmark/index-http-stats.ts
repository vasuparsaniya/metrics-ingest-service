import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { StatsResponse } from '../stats/stats.repository';
import { exactCount } from '../validation/numeric';
import { utcSql } from '../validation/timestamp';

/** Reads benchmark counts without relying on functional dependency from a primary key. */
@Injectable()
export class IndexHttpStatsRepository {
  constructor(private readonly database: DatabaseService) {}

  /** Returns the standard counts and exact UTC coverage contract for either variant. */
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
        FROM series s LEFT JOIN measurements m ON m.series_id = s.id GROUP BY s.id, s.name
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

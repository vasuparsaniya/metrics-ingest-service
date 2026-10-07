import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

/** Stores series names and returns exact database-generated identifiers. */
@Injectable()
export class SeriesRepository {
  constructor(private readonly database: DatabaseService) {}

  async create(name: string): Promise<{ seriesId: string }> {
    const result = await this.database.pool.query<{ seriesId: string }>(
      'INSERT INTO series (name) VALUES ($1) RETURNING id::text AS "seriesId"',
      [name],
    );
    const created = result.rows[0];
    if (!created) throw new Error('Series insert returned no row');
    return created;
  }
}

import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { groupPoints } from '../ingest/ingest.validation';
import { validatePointsCooperatively } from '../ingest/ingest.processing';
import { measurementParameters } from '../ingest/ingest.parameters';
import { IngestResponse } from '../ingest/ingest.types';

/** Identical plain insertion for both benchmark variants; inputs must be fresh. */
export const indexHttpInsertSql = `INSERT INTO measurements (series_id, ts, value)
SELECT series_id, ts, value
FROM unnest($1::bigint[], $2::timestamptz[], $3::numeric[]) AS input(series_id, ts, value)
ORDER BY series_id, ts`;

/** Measures index maintenance through the shared HTTP pipeline without replay handling. */
@Injectable()
export class IndexHttpRepository {
  constructor(private readonly database: DatabaseService) {}

  /** Inserts one unique request atomically using the normal transaction policy. */
  async ingest(
    key: string,
    hash: Buffer,
    rows: readonly unknown[],
  ): Promise<{ response: IngestResponse; replayed: boolean }> {
    return this.database.transaction(async (client) => {
      const claim = await client.query(
        'INSERT INTO ingest_requests (idempotency_key, payload_hash) VALUES ($1, $2)',
        [key, hash],
      );
      if (claim.rowCount !== 1)
        throw new Error('Benchmark request claim count mismatch');
      const { valid, rejected } = await validatePointsCooperatively(rows);
      const ids = [...new Set(valid.map((point) => point.seriesId))];
      const series = await client.query<{ id: string }>(
        'SELECT id::text FROM series WHERE id = ANY($1::bigint[]) ORDER BY id FOR KEY SHARE',
        [ids],
      );
      const present = new Set(series.rows.map((row) => row.id));
      const groups = groupPoints(
        valid.filter((point) => {
          if (present.has(point.seriesId)) return true;
          rejected.push({
            index: point.index,
            reason: 'Series does not exist',
          });
          return false;
        }),
        rejected,
      );
      if (
        rejected.length !== 0 ||
        groups.length !== rows.length ||
        groups.some((group) => group.indexes.length !== 1)
      ) {
        throw new Error(
          'Index HTTP benchmark requires unique valid points in existing series',
        );
      }
      if (groups.length > 0) {
        const inserted = await client.query(
          indexHttpInsertSql,
          await measurementParameters(groups),
        );
        if (inserted.rowCount !== groups.length)
          throw new Error('Benchmark measurement row count mismatch');
      }
      const response: IngestResponse = {
        accepted: groups.length,
        duplicates: 0,
        rejected,
      };
      const saved = await client.query(
        'UPDATE ingest_requests SET response_body = $2::jsonb WHERE idempotency_key = $1',
        [key, JSON.stringify(response)],
      );
      if (saved.rowCount !== 1)
        throw new Error('Benchmark saved response row count mismatch');
      return { response, replayed: false };
    });
  }
}

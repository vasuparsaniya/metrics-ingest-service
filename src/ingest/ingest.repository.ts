import { ConflictException, Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { groupPoints, isRecord, validatePoints } from './ingest.validation';
import { IngestResponse, PointGroup } from './ingest.types';

function savedResponse(value: unknown): IngestResponse {
  if (
    !isRecord(value) ||
    typeof value.accepted !== 'number' ||
    typeof value.duplicates !== 'number' ||
    !Array.isArray(value.rejected)
  ) {
    throw new Error('Stored ingest response is incomplete');
  }
  const rejected = (value.rejected as unknown[]).map((row) => {
    if (
      !isRecord(row) ||
      typeof row.index !== 'number' ||
      typeof row.reason !== 'string'
    )
      throw new Error('Stored rejection is invalid');
    return { index: row.index, reason: row.reason };
  });
  return { accepted: value.accepted, duplicates: value.duplicates, rejected };
}

/** Implements atomic request replay and constraint-backed immutable point insertion. */
@Injectable()
export class IngestRepository {
  constructor(private readonly database: DatabaseService) {}

  async ingest(
    key: string,
    hash: Buffer,
    rows: readonly unknown[],
  ): Promise<{ response: IngestResponse; replayed: boolean }> {
    return this.database.transaction(async (client) => {
      const claim = await client.query(
        'INSERT INTO ingest_requests (idempotency_key, payload_hash) VALUES ($1, $2) ON CONFLICT (idempotency_key) DO NOTHING RETURNING idempotency_key',
        [key, hash],
      );
      if (claim.rowCount === 0) {
        // A new READ COMMITTED statement can see the winner after conflict waiting.
        const existing = await client.query<{
          payload_hash: Buffer;
          response_body: unknown;
        }>(
          'SELECT payload_hash, response_body FROM ingest_requests WHERE idempotency_key = $1',
          [key],
        );
        const stored = existing.rows[0];
        if (!stored)
          throw new Error(
            'Idempotency claim resolved without a committed record',
          );
        if (!stored.payload_hash.equals(hash))
          throw new ConflictException(
            'Idempotency-Key was already used with different content',
          );
        return {
          response: savedResponse(stored.response_body),
          replayed: true,
        };
      }
      const { valid, rejected } = validatePoints(rows);
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
      const response: IngestResponse = { accepted: 0, duplicates: 0, rejected };
      await this.insertGroups(client, groups, response);
      response.rejected.sort((a, b) => a.index - b.index);
      if (
        response.accepted + response.duplicates + response.rejected.length !==
        rows.length
      )
        throw new Error('Ingest response does not account for every input row');
      await client.query(
        'UPDATE ingest_requests SET response_body = $2::jsonb WHERE idempotency_key = $1',
        [key, JSON.stringify(response)],
      );
      return { response, replayed: false };
    });
  }

  private async insertGroups(
    client: PoolClient,
    groups: PointGroup[],
    response: IngestResponse,
  ): Promise<void> {
    if (groups.length === 0) return;
    const ids = groups.map((group) => group.point.seriesId);
    const times = groups.map((group) => group.point.ts);
    const values = groups.map((group) => group.point.value);
    const inserted = await client.query<{ series_id: string; ts: string }>(
      `
      INSERT INTO measurements (series_id, ts, value)
      SELECT series_id, ts, value FROM unnest($1::bigint[], $2::timestamptz[], $3::numeric[]) AS input(series_id, ts, value)
      ORDER BY series_id, ts
      ON CONFLICT (series_id, ts) DO NOTHING
      RETURNING series_id::text, ts::text`,
      [ids, times, values],
    );
    // Classify with ordinality, avoiding timestamp conversion through JavaScript Date.
    const stored = await client.query<{
      ordinal: string;
      identity: string;
      equal: boolean;
    }>(
      `
      SELECT input.ordinal::text, m.series_id::text || ':' || m.ts::text AS identity, m.value = input.value AS equal
      FROM unnest($1::bigint[], $2::timestamptz[], $3::numeric[]) WITH ORDINALITY AS input(series_id, ts, value, ordinal)
      JOIN measurements m ON m.series_id = input.series_id AND m.ts = input.ts
      ORDER BY input.ordinal`,
      [ids, times, values],
    );
    if (stored.rows.length !== groups.length)
      throw new Error('An inserted or conflicting point is missing');
    // Inserted rows are identified by the same typed database identity, never xmin heuristics.
    const newIdentities = new Set(
      inserted.rows.map((row) => `${row.series_id}:${row.ts}`),
    );
    for (const row of stored.rows) {
      const position = Number(row.ordinal) - 1;
      const group = groups[position];
      if (!group) throw new Error('Point classification ordinal is invalid');
      if (!row.equal) {
        for (const index of group.indexes)
          response.rejected.push({
            index,
            reason: 'A point already exists with a different value',
          });
      } else if (newIdentities.has(row.identity)) {
        response.accepted += 1;
        response.duplicates += group.indexes.length - 1;
      } else response.duplicates += group.indexes.length;
    }
  }
}

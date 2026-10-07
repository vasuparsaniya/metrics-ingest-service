import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { applyMigrations } from '../scripts/migrate';
import {
  ServerProcess,
  startServer,
  stopServer,
} from './helpers/server-process';

describe('SIGTERM mid-batch against real PostgreSQL', () => {
  it('rolls back unfinished rows and key, then retries exactly once after process restart', async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (!databaseUrl || databaseUrl === process.env.DATABASE_URL)
      throw new Error('A separate TEST_DATABASE_URL is required');
    await applyMigrations(databaseUrl);
    const pool = new Pool({ connectionString: databaseUrl, max: 3 });
    const token = 'restart-test-token';
    const key = `restart-test-${randomUUID()}`;
    let server: ServerProcess | undefined;
    let id: string | undefined;
    const blocker = await pool.connect();
    try {
      const created = await pool.query<{ id: string }>(
        'INSERT INTO series (name) VALUES ($1) RETURNING id::text',
        [key],
      );
      id = created.rows[0]?.id;
      if (!id) throw new Error('Test series not created');
      server = await startServer(databaseUrl, token);
      await blocker.query('BEGIN');
      await blocker.query(
        'INSERT INTO measurements (series_id, ts, value) VALUES ($1, $2, $3)',
        [id, '2026-10-07T10:01:00Z', '2'],
      );
      const payload = JSON.stringify({
        points: [
          { seriesId: id, ts: '2026-10-07T10:00:00Z', value: '1' },
          { seriesId: id, ts: '2026-10-07T10:01:00Z', value: '2' },
        ],
      });
      const headers = {
        Authorization: `Bearer ${token}`,
        'Idempotency-Key': key,
        'Content-Type': 'application/json',
      };
      const pending = fetch(`${server.url}/v1/ingest`, {
        method: 'POST',
        headers,
        body: payload,
      })
        .then(async (response) => {
          await response.arrayBuffer();
        })
        .catch((error: unknown) => {
          if (
            typeof error !== 'object' ||
            error === null ||
            !('message' in error)
          )
            throw error;
          // SIGTERM can close the socket; database state below determines correctness.
        });
      let waiting = false;
      const deadline = Date.now() + 1500;
      while (Date.now() < deadline) {
        const result = await pool.query<{ waiting: boolean }>(`
          SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = 'metrics-ingest-service'
            AND wait_event_type = 'Lock' AND position('INSERT INTO measurements' in query) > 0) AS waiting`);
        if (result.rows[0]?.waiting) {
          waiting = true;
          break;
        }
        await delay(20);
      }
      expect(waiting).toBe(true);
      await stopServer(server);
      server = undefined;
      await pending;
      await blocker.query('ROLLBACK');
      const aborted = await pool.query<{ count: string }>(
        'SELECT count(*)::text FROM measurements WHERE series_id=$1',
        [id],
      );
      expect(aborted.rows[0]?.count).toBe('0');
      const missingKey = await pool.query(
        'SELECT idempotency_key FROM ingest_requests WHERE idempotency_key=$1',
        [key],
      );
      expect(missingKey.rowCount).toBe(0);
      server = await startServer(databaseUrl, token);
      const first = await fetch(`${server.url}/v1/ingest`, {
        method: 'POST',
        headers,
        body: payload,
      });
      expect(first.status).toBe(200);
      const body: unknown = await first.json();
      expect(body).toEqual({ accepted: 2, duplicates: 0, rejected: [] });
      const retry = await fetch(`${server.url}/v1/ingest`, {
        method: 'POST',
        headers,
        body: payload,
      });
      expect(retry.status).toBe(200);
      expect(await retry.json()).toEqual(body);
      const final = await pool.query<{ count: string; sum: string }>(
        'SELECT count(*)::text, sum(value)::text FROM measurements WHERE series_id=$1',
        [id],
      );
      expect(final.rows[0]).toEqual({ count: '2', sum: '3' });
    } finally {
      if (server) await stopServer(server);
      await blocker.query('ROLLBACK');
      blocker.release();
      if (id) {
        await pool.query('DELETE FROM measurements WHERE series_id=$1', [id]);
        await pool.query('DELETE FROM series WHERE id=$1', [id]);
      }
      await pool.query('DELETE FROM ingest_requests WHERE idempotency_key=$1', [
        key,
      ]);
      await pool.end();
    }
  }, 60000);
});

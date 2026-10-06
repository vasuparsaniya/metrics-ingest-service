import 'dotenv/config';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { readEnvironment } from '../src/config/environment';

async function migrate(): Promise<void> {
  const environment = readEnvironment(process.env);
  const pool = new Pool({
    connectionString: environment.databaseUrl,
    max: 1,
    connectionTimeoutMillis: environment.connectTimeoutMs,
  });
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(71642001)');
      await client.query(
        'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())',
      );
      const directory = resolve(process.cwd(), 'migrations');
      const files = (await readdir(directory))
        .filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name))
        .sort();
      for (const name of files) {
        const sql = await readFile(resolve(directory, name), 'utf8');
        const checksum = createHash('sha256').update(sql).digest('hex');
        const existing = await client.query<{ checksum: string }>(
          'SELECT checksum FROM schema_migrations WHERE name = $1',
          [name],
        );
        const applied = existing.rows[0];
        if (applied) {
          if (applied.checksum !== checksum)
            throw new Error(`Applied migration changed: ${name}`);
          continue;
        }
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)',
          [name, checksum],
        );
        console.log(
          JSON.stringify({
            event: 'migration_executed',
            name,
            outcome: 'pending_commit',
          }),
        );
      }
      await client.query('COMMIT');
      console.log(
        JSON.stringify({ event: 'migrations_complete', outcome: 'committed' }),
      );
    } catch (error: unknown) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError: unknown) {
        throw new AggregateError(
          [error, rollbackError],
          'Migration and rollback failed',
        );
      }
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

void migrate().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Migration failed');
  process.exitCode = 1;
});

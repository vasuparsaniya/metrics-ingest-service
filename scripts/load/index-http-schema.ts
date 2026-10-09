import { Pool } from 'pg';
import { applyMigrations } from '../migrate';
import { postgresSessionOptions } from '../../src/database/session-options';
import {
  assertIndexHttpSchema,
  guardIndexHttpDatabase,
  IndexHttpSchemaSnapshot,
  IndexHttpVariant,
} from '../../src/benchmark/index-http-schema';

/** Creates a new retained experiment database; existing databases are never mutated. */
export async function createIndexHttpDatabase(
  databaseUrl: string,
  variant: IndexHttpVariant,
): Promise<{ pool: Pool; schema: IndexHttpSchemaSnapshot }> {
  const name = guardIndexHttpDatabase(databaseUrl, process.env.DATABASE_URL);
  if (variant !== 'indexed' && variant !== 'unindexed')
    throw new Error('Unknown index HTTP variant');
  const adminUrl = new URL(databaseUrl);
  adminUrl.pathname = '/postgres';
  const admin = new Pool({
    connectionString: adminUrl.toString(),
    max: 1,
    connectionTimeoutMillis: 2000,
    options: postgresSessionOptions,
  });
  try {
    const existing = await admin.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [name],
    );
    if (existing.rowCount !== 0)
      throw new Error(
        'Index HTTP experiment database already exists; refusing mutation',
      );
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
  await applyMigrations(databaseUrl);
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 2,
    connectionTimeoutMillis: 2000,
    options: postgresSessionOptions,
  });
  try {
    await pool.query(
      'ALTER TABLE measurements DROP CONSTRAINT measurements_series_id_fkey',
    );
    if (variant === 'unindexed') {
      await pool.query(
        'ALTER TABLE measurements DROP CONSTRAINT measurements_pkey',
      );
      await pool.query(
        'ALTER TABLE ingest_requests DROP CONSTRAINT ingest_requests_pkey',
      );
      await pool.query('ALTER TABLE series DROP CONSTRAINT series_pkey');
    }
    return { pool, schema: await assertIndexHttpSchema(pool, variant) };
  } catch (error: unknown) {
    await pool.end();
    throw error;
  }
}

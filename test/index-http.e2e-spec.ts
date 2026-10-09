import 'dotenv/config';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { isRecord } from '../src/ingest/ingest.validation';
import {
  guardIndexHttpDatabase,
  assertIndexHttpSchema,
} from '../src/benchmark/index-http-schema';
import { createIndexHttpDatabase } from '../scripts/load/index-http-schema';
import { at } from '../scripts/load/report';
import { postgresSessionOptions } from '../src/database/session-options';

const execute = promisify(execFile);

describe('isolated indexed/unindexed HTTP commands', () => {
  const baseUrl = process.env.TEST_DATABASE_URL;
  const databases: string[] = [];

  beforeAll(() => {
    if (!baseUrl) throw new Error('TEST_DATABASE_URL is required');
    if (baseUrl === process.env.DATABASE_URL)
      throw new Error('Use a separate test database');
  });

  it.each(['indexed', 'unindexed'] as const)(
    'runs %s writes, all route families and reports on a fresh real database',
    async (variant) => {
      if (!baseUrl) throw new Error('Test database is missing');
      const name = `metrics_index_http_smoke_${variant}_${randomUUID().slice(0, 8)}`;
      databases.push(name);
      const directory = resolve(
        'artifacts',
        `index-http-smoke-${randomUUID()}`,
      );
      const { stdout } = await execute(
        process.execPath,
        [
          '--require',
          'ts-node/register',
          'scripts/index-http-benchmark.ts',
          '--variant',
          variant,
          '--database',
          name,
          '--points',
          '80',
          '--samples',
          '20',
          '--report-dir',
          directory,
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            DATABASE_URL: baseUrl,
            API_TOKEN: 'index-http-e2e-token',
          },
          timeout: 60000,
          maxBuffer: 1024 * 1024,
        },
      );
      const events: unknown[] = stdout
        .split('\n')
        .filter((line) => line.startsWith('{'))
        .map((line): unknown => JSON.parse(line));
      const event = events.find(
        (value) => isRecord(value) && value.event === 'index_http_report',
      );
      if (
        !isRecord(event) ||
        typeof event.path !== 'string' ||
        typeof event.markdownPath !== 'string'
      )
        throw new Error('No benchmark report printed');
      expect(event).toMatchObject({ variant, database: name, passed: true });
      const report: unknown = JSON.parse(await readFile(event.path, 'utf8'));
      expect(at(report, 'finalRows')).toBe(80);
      expect(at(report, 'accuracy', 'passed')).toBe(true);
      expect(at(report, 'writeMeasurementValid')).toBe(true);
      expect(at(report, 'machine', 'application')).toContain(
        'index-http-main.js',
      );
      expect(at(report, 'routes', 'passed')).toBe(true);
      expect(at(report, 'aggregateVerification')).toBe(true);
      expect(at(report, 'bucketPlan', 'passed')).toBe(true);
      expect(at(report, 'load', 'ingest', 'retries')).toBe(0);
      expect(at(report, 'idle', 'latest', 'attempted')).toBe(20);
      expect(at(report, 'idle', 'buckets', 'attempted')).toBe(20);
      const markdown = await readFile(event.markdownPath, 'utf8');
      expect(markdown).toContain(
        variant === 'indexed' ? 'WITH INDEXES' : 'WITHOUT BUSINESS INDEXES',
      );
      expect(markdown).toContain('not production compliance');
      const url = new URL(baseUrl);
      url.pathname = `/${name}`;
      const pool = new Pool({
        connectionString: url.toString(),
        options: postgresSessionOptions,
      });
      try {
        const catalog = await assertIndexHttpSchema(pool, variant);
        expect(catalog.indexes).toHaveLength(variant === 'indexed' ? 3 : 0);
        expect(catalog.constraints.some((row) => row.type === 'f')).toBe(false);
        const rows = await pool.query<{ count: string }>(
          'SELECT count(*)::text AS count FROM measurements',
        );
        expect(rows.rows[0]?.count).toBe('80');
        const requests = await pool.query<{ count: string; complete: string }>(
          'SELECT count(*)::text AS count, count(response_body)::text AS complete FROM ingest_requests',
        );
        expect(requests.rows[0]).toEqual({ count: '1', complete: '1' });
        await expect(
          createIndexHttpDatabase(url.toString(), variant),
        ).rejects.toThrow('already exists');
        const afterRefusal = await pool.query<{ count: string }>(
          'SELECT count(*)::text AS count FROM measurements',
        );
        expect(afterRefusal.rows[0]?.count).toBe('80');
      } finally {
        await pool.end();
      }
    },
    90000,
  );

  it('refuses the main database and leaves its required indexes untouched', async () => {
    if (!baseUrl) throw new Error('Test database is missing');
    expect(() => guardIndexHttpDatabase(baseUrl, baseUrl)).toThrow();
    const pool = new Pool({ connectionString: baseUrl });
    try {
      const indexes = await pool.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM pg_indexes WHERE schemaname='public' AND tablename IN ('series','measurements','ingest_requests')`,
      );
      expect(indexes.rows[0]?.count).toBe('3');
    } finally {
      await pool.end();
    }
  });

  afterAll(() => {
    // Retained tiny test databases are evidence; never delete a database inferred from a name.
    if (databases.length)
      console.log(
        JSON.stringify({
          event: 'index_http_smoke_databases_retained',
          databases,
        }),
      );
  });
});

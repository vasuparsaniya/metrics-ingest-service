import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { bucketSql } from '../../src/queries/bucket.sql';
import { LoadManifest } from './types';
import { batchAt } from './generator';
import { latency } from './metrics';

function tableName(name: string): string {
  if (!/^bench_[a-z0-9_]+$/.test(name))
    throw new Error('Refusing unrelated experiment table');
  return `"${name}"`;
}

async function insertRun(
  pool: Pool,
  manifest: LoadManifest,
  name: string,
  strategy: 'unnest' | 'values',
): Promise<object> {
  let next = 0;
  let inserted = 0;
  const started = performance.now();
  const worker = async (): Promise<void> => {
    while (next < Math.ceil(manifest.total / manifest.batchSize)) {
      const batch = next++;
      const points = batchAt(manifest, batch);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        let result;
        if (strategy === 'unnest') {
          result = await client.query(
            `INSERT INTO ${tableName(name)}(series_id,ts,value)
            SELECT series_id,ts,value FROM unnest($1::bigint[],$2::timestamptz[],$3::numeric[]) AS p(series_id,ts,value)
            ORDER BY series_id,ts ON CONFLICT(series_id,ts) DO NOTHING RETURNING series_id,ts`,
            [
              points.map((p) => p.seriesId),
              points.map((p) => p.ts),
              points.map((p) => p.value),
            ],
          );
        } else {
          const parameters = points.flatMap((p) => [p.seriesId, p.ts, p.value]);
          const placeholders = points
            .map(
              (_, i) =>
                `($${i * 3 + 1}::bigint,$${i * 3 + 2}::timestamptz,$${i * 3 + 3}::numeric)`,
            )
            .join(',');
          result = await client.query(
            `INSERT INTO ${tableName(name)}(series_id,ts,value)
            SELECT series_id,ts,value FROM (VALUES ${placeholders}) AS p(series_id,ts,value)
            ORDER BY series_id,ts ON CONFLICT(series_id,ts) DO NOTHING RETURNING series_id,ts`,
            parameters,
          );
        }
        await client.query('COMMIT');
        inserted += result.rowCount ?? 0;
      } catch (error: unknown) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError: unknown) {
          throw new AggregateError(
            [error, rollbackError],
            'Experiment rollback failed',
          );
        }
        throw error;
      } finally {
        client.release();
      }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  const wallMs = performance.now() - started;
  if (inserted !== manifest.total)
    throw new Error('Experiment inserted the wrong row count');
  const stored = await pool.query<{ id: string; count: string; sum: string }>(
    `
    SELECT series_id::text AS id,count(*)::text AS count,sum(value)::text AS sum
    FROM ${tableName(name)} GROUP BY series_id`,
    [],
  );
  const { decimal } = await import('../../src/validation/numeric');
  for (const expected of manifest.expected) {
    const actual = stored.rows.find((row) => row.id === expected.seriesId);
    if (
      !actual ||
      String(expected.count) !== actual.count ||
      decimal(expected.sum) !== decimal(actual.sum)
    )
      throw new Error('Experiment failed exact count/sum reconciliation');
  }
  return {
    table: name,
    strategy,
    inserted,
    wallMs,
    pointsPerSecond: inserted / (wallMs / 1000),
    accuracy: 'per-series count and exact sum matched',
  };
}

async function plan(
  pool: Pool,
  sql: string,
  parameters: readonly string[],
): Promise<object> {
  const started = performance.now();
  const result = await pool.query<{ 'QUERY PLAN': string }>(
    `EXPLAIN (ANALYZE, BUFFERS) ${sql}`,
    [...parameters],
  );
  return {
    wallMs: performance.now() - started,
    output: result.rows.map((row) => row['QUERY PLAN']).join('\n'),
  };
}

/** Measures write strategy/index costs on isolated tables without dropping production constraints. */
export async function compare(
  pool: Pool,
  manifest: LoadManifest,
): Promise<object> {
  const prefix = `bench_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const base = `${prefix}_base`;
  const values = `${prefix}_values`;
  const cover = `${prefix}_cover`;
  for (const name of [base, values, cover])
    await pool.query(`CREATE TABLE ${tableName(name)}
    (LIKE measurements INCLUDING CONSTRAINTS, PRIMARY KEY(series_id,ts), FOREIGN KEY(series_id) REFERENCES series(id))`);
  const coverIndex = `${prefix}_cover_idx`;
  await pool.query(
    `CREATE INDEX "${coverIndex}" ON ${tableName(cover)}(series_id,ts DESC) INCLUDE(value)`,
  );
  const unnest = await insertRun(pool, manifest, base, 'unnest');
  const multiValues = await insertRun(pool, manifest, values, 'values');
  const indexed = await insertRun(pool, manifest, cover, 'unnest');
  for (const name of [base, values, cover])
    await pool.query(`ANALYZE ${tableName(name)}`);
  const id = manifest.seriesIds[0];
  if (!id) throw new Error('Missing comparison series');
  const parameters = [id, manifest.from, manifest.to, 'hour', '1 hour'];
  const baseSql = bucketSql.replaceAll('measurements', tableName(base));
  const coverSql = bucketSql.replaceAll('measurements', tableName(cover));
  const productionPlan = await plan(pool, bucketSql, parameters);
  const lookupPlans = {
    series: await plan(pool, 'SELECT id FROM series WHERE id = $1::bigint', [
      id,
    ]),
    latest: await plan(
      pool,
      'SELECT ts,value FROM measurements WHERE series_id = $1::bigint ORDER BY ts DESC LIMIT 1',
      [id],
    ),
    requestReplay: await plan(
      pool,
      'SELECT payload_hash,response_body FROM ingest_requests WHERE idempotency_key = $1',
      [`load:${manifest.runId}:0`],
    ),
  };
  const baselinePlan = await plan(pool, baseSql, parameters);
  const coverPlan = await plan(pool, coverSql, parameters);
  const queryTimings: Record<string, object> = {};
  for (const [label, sql] of [
    ['primaryOnly', baseSql],
    ['withCoveringIndex', coverSql],
  ] as const) {
    const samples: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const start = performance.now();
      await pool.query(sql, parameters);
      samples.push(performance.now() - start);
    }
    queryTimings[label] = latency(samples);
  }
  const sizes = await pool.query<{ relation: string; bytes: string }>(
    `
    SELECT c.relname AS relation, pg_relation_size(c.oid)::text AS bytes
    FROM pg_class c WHERE c.relname = ANY($1::text[]) ORDER BY c.relname`,
    [[base, `${base}_pkey`, cover, `${cover}_pkey`, coverIndex]],
  );
  // A transaction-local planner experiment keeps the actual identity constraint intact.
  const client = await pool.connect();
  let noIndexEvidence: object;
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '30000'");
    await client.query('SET LOCAL enable_indexscan = off');
    await client.query('SET LOCAL enable_indexonlyscan = off');
    await client.query('SET LOCAL enable_bitmapscan = off');
    const started = performance.now();
    try {
      const output = await client.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN (ANALYZE, BUFFERS) ${baseSql}`,
        parameters,
      );
      noIndexEvidence = {
        wallMs: performance.now() - started,
        output: output.rows.map((row) => row['QUERY PLAN']).join('\n'),
      };
    } catch (error: unknown) {
      noIndexEvidence = {
        wallMs: performance.now() - started,
        error: error instanceof Error ? error.message : String(error),
        note: '30-second timeout is a measured failure; no EXPLAIN output is fabricated.',
      };
    }
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
  return {
    fullAssignmentScale: manifest.total === 2000000,
    retainedTables: [base, values, cover],
    writeStrategies: {
      unnestPrimaryOnly: unnest,
      valuesPrimaryOnly: multiValues,
      unnestWithCoveringIndex: indexed,
    },
    readPlans: {
      production: productionPlan,
      primaryOnly: baselinePlan,
      withCoveringIndex: coverPlan,
      indexesDisabled: noIndexEvidence,
    },
    lookupPlans,
    queryTimings,
    sizes: sizes.rows,
    methodology:
      'Insert-kernel microbenchmark, 8 writers/5000 points per transaction, identical constraints and generated data. It excludes HTTP validation, hashing, idempotency-table writes, and post-insert classification; not an end-to-end throughput claim. Runs are sequential and cache/order noise must be considered. Tables are retained.',
    indexExperiment:
      'PK stays in place. Covering-index write cost is measured with/without that optional index. Planner disabling demonstrates a no-index-read plan, not an actual dropped correctness constraint. No production index is changed; an index or rewrite is adopted only after reviewing measured full-scale evidence.',
  };
}

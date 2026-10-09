import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Pool } from 'pg';
import { decimal } from '../../src/validation/numeric';
import { batchAt } from './generator';
import { LoadManifest } from './types';

/** Measured, reconciled write-kernel result for one isolated schema variant. */
export interface PrimaryIndexRun {
  table: string;
  primaryKey: boolean;
  rows: number;
  wallMs: number;
  pointsPerSecond: number;
  heapBytes: string;
  indexBytes: string;
  indexes: { name: string; definition: string }[];
  constraints: { name: string; type: string; definition: string }[];
  reconciliation: { id: string; count: string; sum: string }[];
}

/** Quotes only names owned by this experiment, never business-table identifiers. */
export function primaryCostTable(name: string): string {
  if (!/^bench_pkcost_[a-f0-9]{16}_(pk|heap)$/.test(name))
    throw new Error('Refusing unrelated index-cost table');
  return `"${name}"`;
}

/** Both variants use identical plain insertion; unique points need no conflict clause. */
export function primaryCostInsert(name: string): string {
  return `INSERT INTO ${primaryCostTable(name)} (series_id,ts,value)
    SELECT series_id,ts,value
    FROM unnest($1::bigint[],$2::timestamptz[],$3::numeric[]) AS p(series_id,ts,value)
    ORDER BY series_id,ts`;
}

async function measure(
  pool: Pool,
  manifest: LoadManifest,
  name: string,
  primaryKey: boolean,
): Promise<PrimaryIndexRun> {
  let next = 0;
  let inserted = 0;
  let failure: unknown;
  let failed = false;
  const sql = primaryCostInsert(name);
  const start = performance.now();
  const worker = async (): Promise<void> => {
    try {
      while (!failed && next < Math.ceil(manifest.total / manifest.batchSize)) {
        const points = batchAt(manifest, next++);
        // One autocommitted statement is one atomic batch, including FK checks.
        const result = await pool.query(sql, [
          points.map((point) => point.seriesId),
          points.map((point) => point.ts),
          points.map((point) => point.value),
        ]);
        if (result.rowCount !== points.length)
          throw new Error('Batch inserted an unexpected number of rows');
        inserted += result.rowCount;
      }
    } catch (error: unknown) {
      if (!failed) failure = error;
      failed = true;
    }
  };
  // Drain all active workers before propagating an error or closing the pool.
  await Promise.all(Array.from({ length: manifest.writers }, worker));
  if (failed) throw failure;
  const wallMs = performance.now() - start;
  if (inserted !== manifest.total) throw new Error('Unexpected total inserts');
  const stored = await pool.query<{ id: string; count: string; sum: string }>(
    `SELECT series_id::text AS id,count(*)::text AS count,sum(value)::text AS sum
     FROM ${primaryCostTable(name)} GROUP BY series_id ORDER BY series_id`,
  );
  if (stored.rows.length !== manifest.expected.length)
    throw new Error('Unexpected number of series');
  for (const expected of manifest.expected) {
    const actual = stored.rows.find((row) => row.id === expected.seriesId);
    if (
      !actual ||
      actual.count !== String(expected.count) ||
      decimal(actual.sum) !== decimal(expected.sum)
    )
      throw new Error('Exact count/sum reconciliation failed');
  }
  const size = (
    await pool.query<{ heap: string; indexes: string }>(
      'SELECT pg_relation_size($1::regclass)::text AS heap,pg_indexes_size($1::regclass)::text AS indexes',
      [name],
    )
  ).rows[0];
  if (!size) throw new Error('Missing size evidence');
  const indexes = (
    await pool.query<{ name: string; definition: string }>(
      `SELECT c.relname AS name,pg_get_indexdef(c.oid) AS definition
     FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
     WHERE i.indrelid=$1::regclass ORDER BY c.relname`,
      [name],
    )
  ).rows;
  const constraints = (
    await pool.query<{ name: string; type: string; definition: string }>(
      `SELECT conname AS name,contype::text AS type,pg_get_constraintdef(oid) AS definition
     FROM pg_constraint WHERE conrelid=$1::regclass ORDER BY conname`,
      [name],
    )
  ).rows;
  if (
    indexes.length !== (primaryKey ? 1 : 0) ||
    constraints.filter((constraint) => constraint.type === 'p').length !==
      (primaryKey ? 1 : 0) ||
    constraints.filter((constraint) => constraint.type === 'f').length !== 1
  )
    throw new Error('Schema variant does not match measured configuration');
  return {
    table: name,
    primaryKey,
    rows: inserted,
    wallMs,
    pointsPerSecond: inserted / (wallMs / 1000),
    heapBytes: size.heap,
    indexBytes: size.indexes,
    indexes,
    constraints,
    reconciliation: stored.rows,
  };
}

/** Physically removes only an isolated table's PK, then measures identical unique inserts. */
export async function primaryIndexCost(
  pool: Pool,
  manifest: LoadManifest,
): Promise<{
  withPrimaryKey: PrimaryIndexRun;
  withoutPrimaryKey: PrimaryIndexRun;
}> {
  const prefix = `bench_pkcost_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const pk = `${prefix}_pk`;
  const heap = `${prefix}_heap`;
  const present = await pool.query<{ id: string }>(
    'SELECT id::text AS id FROM series WHERE id=ANY($1::bigint[])',
    [manifest.seriesIds],
  );
  if (present.rows.length !== manifest.seriesIds.length)
    throw new Error('Manifest series are missing from the selected database');
  const ddl = await pool.connect();
  try {
    await ddl.query('BEGIN');
    for (const name of [pk, heap])
      await ddl.query(`CREATE TABLE ${primaryCostTable(name)}
        (LIKE measurements INCLUDING CONSTRAINTS, PRIMARY KEY(series_id,ts),
         FOREIGN KEY(series_id) REFERENCES series(id))`);
    await ddl.query(
      `ALTER TABLE ${primaryCostTable(heap)} DROP CONSTRAINT "${heap}_pkey"`,
    );
    await ddl.query('COMMIT');
  } catch (error: unknown) {
    try {
      await ddl.query('ROLLBACK');
    } catch (rollback: unknown) {
      throw new AggregateError(
        [error, rollback],
        'Experiment DDL rollback failed',
      );
    }
    throw error;
  } finally {
    ddl.release();
  }
  console.log(
    JSON.stringify({
      event: 'primary_index_cost_start',
      pk,
      heap,
      points: manifest.total,
    }),
  );
  const withPrimaryKey = await measure(pool, manifest, pk, true);
  console.log(
    JSON.stringify({
      event: 'primary_index_cost_variant',
      table: pk,
      throughput: withPrimaryKey.pointsPerSecond,
    }),
  );
  const withoutPrimaryKey = await measure(pool, manifest, heap, false);
  return { withPrimaryKey, withoutPrimaryKey };
}

/** Readable summary clearly separates write-kernel evidence from HTTP acceptance. */
export function primaryIndexMarkdown(
  result: Awaited<ReturnType<typeof primaryIndexCost>>,
): string {
  const pk = result.withPrimaryKey;
  const heap = result.withoutPrimaryKey;
  return (
    `# Measurements primary-key write cost\n\nDirect database write-kernel experiment, not HTTP acceptance.\n\n` +
    `| Check | PK retained | PK physically removed |\n|---|---:|---:|\n` +
    `| Rows | ${pk.rows} | ${heap.rows} |\n` +
    `| Throughput points/sec | ${pk.pointsPerSecond.toFixed(2)} | ${heap.pointsPerSecond.toFixed(2)} |\n` +
    `| Duration seconds | ${(pk.wallMs / 1000).toFixed(2)} | ${(heap.wallMs / 1000).toFixed(2)} |\n` +
    `| Index bytes | ${pk.indexBytes} | ${heap.indexBytes} |\n\n` +
    `Both variants retain FK/checks and use identical ordered plain UNNEST INSERTs. Exact per-series counts/sums verified.\n\n` +
    `PK throughput cost versus no PK: ${((1 - pk.pointsPerSecond / heap.pointsPerSecond) * 100).toFixed(2)}%.\n\n` +
    `Sequential PK-first ordering, generation/driver overhead and host/cache/checkpoint variation limit causal attribution. ` +
    `No-index tables are unsafe for production deduplication. Other required indexes remain unmeasured.\n\n` +
    `Retained tables: ${pk.table}, ${heap.table}. Full schema, reconciliation and machine evidence: [JSON](report.json).\n`
  );
}

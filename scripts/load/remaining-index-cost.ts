import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Pool } from 'pg';

/** Two independent synthetic insertion workloads, never measurement ingestion. */
export type KeyCostKind = 'series' | 'requests';

/** Validated, reconciled evidence for an isolated index variant. */
export interface KeyCostResult {
  kind: KeyCostKind;
  table: string;
  primaryKey: boolean;
  rows: number;
  wallMs: number;
  rowsPerSecond: number;
  heapBytes: string;
  indexBytes: string;
  indexes: { definition: string }[];
  constraints: { type: string; definition: string }[];
  verified: boolean;
}

/** Rejects business names and SQL injection before any DDL or insertion. */
export function indexCostTable(name: string): string {
  if (!/^bench_keycost_[a-f0-9]{16}_(series|requests)_(pk|heap)$/.test(name))
    throw new Error('Refusing unrelated index-cost table');
  return `"${name}"`;
}

/** Bounds optional synthetic sample sizes independently of API batch limits. */
export function validateIndexCostRows(rows: number): number {
  if (!Number.isSafeInteger(rows) || rows < 8 || rows > 2000000)
    throw new Error('Synthetic rows must be between 8 and 2000000');
  return rows;
}

/** Identical plain SQL on both variants isolates index maintenance, not conflicts. */
export function indexCostInsert(name: string, kind: KeyCostKind): string {
  const table = indexCostTable(name);
  return kind === 'series'
    ? `INSERT INTO ${table} (name) SELECT name FROM unnest($1::text[]) AS p(name) ORDER BY name`
    : `INSERT INTO ${table} (idempotency_key,payload_hash,response_body)
       SELECT key,$2::bytea,$3::jsonb FROM unnest($1::text[]) AS p(key) ORDER BY key`;
}

const response = JSON.stringify({
  accepted: 5000,
  duplicates: 0,
  rejected: [],
});
const hash = Buffer.alloc(32, 7);

async function measure(
  pool: Pool,
  kind: KeyCostKind,
  table: string,
  primaryKey: boolean,
  rows: number,
): Promise<KeyCostResult> {
  const sql = indexCostInsert(table, kind);
  let next = 0;
  let inserted = 0;
  let failed = false;
  let failure: unknown;
  const started = performance.now();
  const worker = async (): Promise<void> => {
    try {
      while (!failed && next < rows) {
        const start = next;
        next = Math.min(rows, next + 5000);
        const keys = Array.from(
          { length: next - start },
          (_, index) => `cost:${String(start + index + 1).padStart(10, '0')}`,
        );
        const result = await pool.query(
          sql,
          kind === 'series' ? [keys] : [keys, hash, response],
        );
        if (result.rowCount !== keys.length)
          throw new Error('Unexpected batch row count');
        inserted += result.rowCount;
      }
    } catch (error: unknown) {
      if (!failed) failure = error;
      failed = true;
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  if (failed) throw failure;
  const wallMs = performance.now() - started;
  if (inserted !== rows) throw new Error('Unexpected total inserts');
  const quoted = indexCostTable(table);
  const key = kind === 'series' ? 'name' : 'idempotency_key';
  const payload =
    kind === 'series'
      ? `id BETWEEN 1 AND $1 AND name ~ '^cost:[0-9]{10}$' AND substring(name from 6)::bigint BETWEEN 1 AND $1`
      : `idempotency_key ~ '^cost:[0-9]{10}$' AND substring(idempotency_key from 6)::bigint BETWEEN 1 AND $1 AND payload_hash=$2::bytea AND response_body IS NOT DISTINCT FROM $3::jsonb`;
  const verified = (
    await pool.query<{
      count: string;
      distinct_keys: string;
      valid: boolean;
      ids: string;
    }>(
      `SELECT count(*)::text AS count,count(DISTINCT ${key})::text AS distinct_keys,
      bool_and(${payload}) AS valid,${kind === 'series' ? 'count(DISTINCT id)' : 'count(*)'}::text AS ids FROM ${quoted}`,
      kind === 'series' ? [rows] : [rows, hash, response],
    )
  ).rows[0];
  if (
    !verified ||
    verified.count !== String(rows) ||
    verified.distinct_keys !== String(rows) ||
    verified.ids !== String(rows) ||
    !verified.valid
  )
    throw new Error('Exact key/identity/payload reconciliation failed');
  const indexes = (
    await pool.query<{ definition: string }>(
      'SELECT pg_get_indexdef(indexrelid) AS definition FROM pg_index WHERE indrelid=$1::regclass',
      [table],
    )
  ).rows;
  const constraints = (
    await pool.query<{ type: string; definition: string }>(
      'SELECT contype AS type,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid=$1::regclass ORDER BY contype,definition',
      [table],
    )
  ).rows;
  if (
    indexes.length !== (primaryKey ? 1 : 0) ||
    constraints.filter((item) => item.type === 'p').length !==
      (primaryKey ? 1 : 0)
  )
    throw new Error('Unexpected experiment indexes');
  const size = (
    await pool.query<{ heap: string; indexes: string }>(
      'SELECT pg_relation_size($1::regclass)::text AS heap,pg_indexes_size($1::regclass)::text AS indexes',
      [table],
    )
  ).rows[0];
  if (!size) throw new Error('Missing size evidence');
  return {
    kind,
    table,
    primaryKey,
    rows,
    wallMs,
    rowsPerSecond: (rows * 1000) / wallMs,
    heapBytes: size.heap,
    indexBytes: size.indexes,
    indexes,
    constraints,
    verified: true,
  };
}

/** Creates only isolated copies and physically drops their private primary keys. */
export async function remainingIndexCost(
  pool: Pool,
  rows: number,
): Promise<KeyCostResult[]> {
  validateIndexCostRows(rows);
  const results: KeyCostResult[] = [];
  const prefix = `bench_keycost_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  for (const kind of ['series', 'requests'] as const) {
    const source = kind === 'series' ? 'series' : 'ingest_requests';
    const column = kind === 'series' ? 'id' : 'idempotency_key';
    const pk = `${prefix}_${kind}_pk`;
    const heap = `${prefix}_${kind}_heap`;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const name of [pk, heap])
        await client.query(
          `CREATE TABLE ${indexCostTable(name)} (LIKE ${source} INCLUDING CONSTRAINTS INCLUDING IDENTITY, PRIMARY KEY (${column}))`,
        );
      await client.query(
        `ALTER TABLE ${indexCostTable(heap)} DROP CONSTRAINT "${heap}_pkey"`,
      );
      await client.query('COMMIT');
    } catch (error: unknown) {
      try {
        await client.query('ROLLBACK');
      } catch (rollback: unknown) {
        throw new AggregateError([error, rollback], 'DDL and rollback failed');
      }
      throw error;
    } finally {
      client.release();
    }
    const withPk = await measure(pool, kind, pk, true, rows);
    const withoutPk = await measure(pool, kind, heap, false, rows);
    if (
      JSON.stringify(withPk.constraints.filter((item) => item.type !== 'p')) !==
      JSON.stringify(withoutPk.constraints)
    )
      throw new Error('Variant checks differ');
    results.push(withPk, withoutPk);
    console.log(
      JSON.stringify({
        event: 'key_index_cost_variant',
        kind,
        withPrimaryKey: withPk.rowsPerSecond,
        withoutPrimaryKey: withoutPk.rowsPerSecond,
      }),
    );
  }
  return results;
}

/** Formats synthetic results without claiming HTTP or measurement throughput. */
export function remainingIndexMarkdown(results: KeyCostResult[]): string {
  return (
    '# Remaining required-index write cost\n\nSynthetic direct SQL inserts; not HTTP acceptance or measurement points/sec.\n\n' +
    '| Table | PK retained | Rows | Rows/sec | Seconds | Index bytes | Verified |\n|---|---|---:|---:|---:|---:|---|\n' +
    results
      .map(
        (item) =>
          `| ${item.kind} | ${item.primaryKey} | ${item.rows} | ${item.rowsPerSecond.toFixed(2)} | ${(item.wallMs / 1000).toFixed(2)} | ${item.indexBytes} | ${item.verified} |`,
      )
      .join('\n') +
    '\n\n5,000 rows/batch; eight workers. Indexed-first sequential trials include generation/driver overhead but exclude DDL and verification. Cache/checkpoint/host noise limits causal attribution. Production keys remain required. Tables are retained; actual constraints, indexes, names and machine: [JSON](report.json).\n'
  );
}

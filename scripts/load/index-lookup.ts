import { performance } from 'node:perf_hooks';
import { Pool } from 'pg';
import { isRecord } from '../../src/ingest/ingest.validation';
import { primaryCostTable } from './primary-index-cost';
import { indexCostTable } from './remaining-index-cost';
import { latency } from './metrics';

/** Queries whose required-index plans are compared on isolated copies. */
export type LookupKind = 'latest' | 'range' | 'series' | 'requests';

/** Validated physical table pair from an earlier reconciled write-cost report. */
export interface LookupPair {
  kind: LookupKind;
  indexed: string;
  unindexed: string;
  rows: number;
}

/** Validates owned experiment identifiers; never allows business-table access. */
export function lookupTable(name: string): string {
  return name.startsWith('bench_pkcost_')
    ? primaryCostTable(name)
    : indexCostTable(name);
}

/** Validates artifact schemas, ownership, counts and variant ordering before SQL. */
export function lookupPairs(primary: unknown, keys: unknown): LookupPair[] {
  if (
    !isRecord(primary) ||
    primary.kind !== 'primary-index-cost' ||
    !isRecord(keys) ||
    keys.kind !== 'remaining-index-cost' ||
    !Array.isArray(keys.results)
  )
    throw new Error('Expected primary and remaining index-cost reports');
  const pair = (kind: LookupKind, pk: unknown, heap: unknown): LookupPair => {
    if (
      !isRecord(pk) ||
      !isRecord(heap) ||
      typeof pk.table !== 'string' ||
      typeof heap.table !== 'string' ||
      pk.primaryKey !== true ||
      heap.primaryKey !== false ||
      typeof pk.rows !== 'number' ||
      !Number.isSafeInteger(pk.rows) ||
      pk.rows < 8 ||
      heap.rows !== pk.rows ||
      !pk.table.endsWith('_pk') ||
      pk.table.slice(0, -3) + '_heap' !== heap.table
    )
      throw new Error('Invalid matching table pair');
    lookupSql(kind, pk.table);
    lookupSql(kind, heap.table);
    return { kind, indexed: pk.table, unindexed: heap.table, rows: pk.rows };
  };
  const keyResults: unknown[] = keys.results;
  return [
    pair('latest', primary.withPrimaryKey, primary.withoutPrimaryKey),
    pair('range', primary.withPrimaryKey, primary.withoutPrimaryKey),
    ...(['series', 'requests'] as const).map((kind) => {
      const matching = keyResults.filter(
        (item: unknown) => isRecord(item) && item.kind === kind,
      );
      if (matching.length !== 2)
        throw new Error('Expected exactly two key variants');
      return pair(
        kind,
        matching.find(
          (item: unknown) => isRecord(item) && item.primaryKey === true,
        ),
        matching.find(
          (item: unknown) => isRecord(item) && item.primaryKey === false,
        ),
      );
    }),
  ];
}

/** Keeps projections and predicates identical across the two physical variants. */
export function lookupSql(kind: LookupKind, name: string): string {
  const table = lookupTable(name);
  if (
    kind === 'latest' || kind === 'range'
      ? !name.startsWith('bench_pkcost_')
      : !name.includes(`_${kind}_`)
  )
    throw new Error('Lookup kind does not match experiment table');
  if (kind === 'latest')
    return `SELECT m.ts::text,m.value::text FROM ${table} AS m WHERE m.series_id=$1::bigint ORDER BY m.ts DESC LIMIT 1`;
  if (kind === 'range')
    return `SELECT count(*)::text,sum(value)::text,min(value)::text,max(value)::text FROM ${table} WHERE series_id=$1::bigint AND ts >= $2::timestamptz AND ts < $3::timestamptz`;
  if (kind === 'series')
    return `SELECT id::text FROM ${table} WHERE id=$1::bigint`;
  return `SELECT encode(payload_hash,'hex') AS payload_hash,response_body FROM ${table} WHERE idempotency_key=$1`;
}

/** Collects exact results, repeated direct SQL timing and real text plans. */
export async function compareLookups(pool: Pool, pairs: LookupPair[]) {
  for (const pair of pairs) {
    for (const [name, expectedIndexes] of [
      [pair.indexed, 1],
      [pair.unindexed, 0],
    ] as const) {
      const table = lookupTable(name);
      const catalog = (
        await pool.query<{ indexes: string; rows: string }>(
          `SELECT (SELECT count(*) FROM pg_index WHERE indrelid=$1::regclass)::text AS indexes,(SELECT count(*) FROM ${table})::text AS rows`,
          [name],
        )
      ).rows[0];
      if (
        !catalog ||
        catalog.indexes !== String(expectedIndexes) ||
        catalog.rows !== String(pair.rows)
      )
        throw new Error('Physical index or dataset count mismatch');
      await pool.query(`ANALYZE ${table}`);
    }
  }
  const evidence = [];
  for (const pair of pairs) {
    const parameters =
      pair.kind === 'requests'
        ? [`cost:${String(Math.floor(pair.rows / 2)).padStart(10, '0')}`]
        : pair.kind === 'series'
          ? [String(Math.floor(pair.rows / 2))]
          : pair.kind === 'range'
            ? ['1', '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z']
            : ['1'];
    const variants = [pair.indexed, pair.unindexed].map((table) => ({
      table,
      sql: lookupSql(pair.kind, table),
      samples: [] as number[],
    }));
    const results = [];
    for (const variant of variants)
      results.push(
        (await pool.query<Record<string, unknown>>(variant.sql, parameters))
          .rows,
      );
    if (
      results[0]?.length !== 1 ||
      JSON.stringify(results[0]) !== JSON.stringify(results[1])
    )
      throw new Error('Lookup results differ or matching point/key is absent');
    if (
      pair.kind === 'range' &&
      (!isRecord(results[0][0]) || results[0][0].count === '0')
    )
      throw new Error('Range contains no measurements');
    // Alternate order after warmup, rather than timing all indexed reads first.
    for (let sample = 0; sample < 20; sample += 1) {
      for (const variant of sample % 2 ? [...variants].reverse() : variants) {
        const start = performance.now();
        const actual = await pool.query<Record<string, unknown>>(
          variant.sql,
          parameters,
        );
        variant.samples.push(performance.now() - start);
        if (JSON.stringify(actual.rows) !== JSON.stringify(results[0]))
          throw new Error('Lookup changed during comparison');
      }
    }
    const plans = [];
    for (const variant of variants) {
      const output = await pool.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN (ANALYZE, BUFFERS) ${variant.sql}`,
        parameters,
      );
      plans.push({
        table: variant.table,
        primaryKey: variant.table === pair.indexed,
        sql: variant.sql,
        latency: latency(variant.samples),
        output: output.rows.map((row) => row['QUERY PLAN']).join('\n'),
      });
    }
    evidence.push({
      kind: pair.kind,
      rows: pair.rows,
      parameters,
      matchingResult: results[0],
      plans,
    });
    console.log(
      JSON.stringify({
        event: 'index_lookup_verified',
        kind: pair.kind,
        rows: pair.rows,
      }),
    );
  }
  return evidence;
}

/** Includes raw plans in a portable readable report without claiming HTTP p95. */
export function lookupMarkdown(
  evidence: Awaited<ReturnType<typeof compareLookups>>,
): string {
  return (
    '# Required-index lookup evidence\n\nDirect SQL, idle, 20 alternating samples per variant after warmup. Actual indexes physically absent from heap variants. Results match exactly; no production indexes changed.\n\n' +
    evidence
      .map(
        (item) =>
          `## ${item.kind} (${item.rows} table rows)\n\nParameters: ${JSON.stringify(item.parameters)}\n\n` +
          item.plans
            .map(
              (plan) =>
                `### ${plan.primaryKey ? 'With primary key' : 'Without primary key'}\n\nDirect SQL p50/p95: ${plan.latency.p50Ms?.toFixed(3)} / ${plan.latency.p95Ms?.toFixed(3)} ms.\n\n\`\`\`sql\nEXPLAIN (ANALYZE, BUFFERS) ${plan.sql};\n\`\`\`\n\n\`\`\`text\n${plan.output}\n\`\`\`\n`,
            )
            .join('\n'),
      )
      .join('\n') +
    '\nStatistics ANALYZE applies only to test copies. Repeated idle/cache-warmed SQL timings are not HTTP targets or fresh-write latency; synthetic key sizes differ from the acceptance workload. Current bucket-query evidence is recorded separately. Full evidence: [JSON](report.json).\n'
  );
}

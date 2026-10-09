import { Pool } from 'pg';
import { options } from './options';
import { benchmarkUrl } from './runtime';

/** PostgreSQL relation bytes; tableBytes includes auxiliary forks and TOAST. */
export interface StorageRelation {
  schema: string;
  name: string;
  mainForkBytes: string;
  tableBytes: string;
  indexBytes: string;
  totalBytes: string;
}

/** Endpoint sizes and cluster-wide WAL insert position, never peak disk usage. */
export interface StorageSnapshot {
  observedAt: string;
  serverStartedAt: string;
  databaseBytes: string;
  walRetainedBytes: string;
  walInsertLsn: string;
  relations: StorageRelation[];
}

/** Parses explicit opt-in, preventing accidental replay or concurrent measurement. */
export function storageArguments(args: string[]) {
  const confirmations = args.filter(
    (arg) => arg === '--confirm-exclusive-cluster',
  ).length;
  const settings = options(
    args.filter((arg) => arg !== '--confirm-exclusive-cluster'),
  );
  if (
    !settings.help &&
    (confirmations !== 1 || !settings.database || settings.manifest)
  )
    throw new Error(
      'Require --database and exactly one --confirm-exclusive-cluster; replay is not supported',
    );
  return settings;
}

/** Requires a local, explicitly selected database other than the main environment DB. */
export function storageDatabase(
  env: NodeJS.ProcessEnv,
  database: string,
): string {
  const url = new URL(benchmarkUrl(env, database));
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.pathname === new URL(benchmarkUrl(env)).pathname
  )
    throw new Error(
      'Storage measurement requires an isolated local non-main database',
    );
  return url.toString();
}

/** Refuses retained data or experiment tables rather than resetting any database. */
export async function requireFreshStorageDatabase(pool: Pool): Promise<void> {
  const tables = await pool.query<{ schema: string; name: string }>(
    'SELECT schemaname AS schema,relname AS name FROM pg_stat_user_tables ORDER BY relname',
  );
  const expected = [
    'ingest_requests',
    'measurements',
    'schema_migrations',
    'series',
  ];
  if (
    tables.rows.length !== expected.length ||
    tables.rows.some(
      (row, index) => row.schema !== 'public' || row.name !== expected[index],
    )
  )
    throw new Error(
      'Use a fresh database with only application/migration tables',
    );
  const counts = (
    await pool.query<{ empty: boolean }>(
      'SELECT NOT EXISTS(SELECT 1 FROM measurements) AND NOT EXISTS(SELECT 1 FROM series) AND NOT EXISTS(SELECT 1 FROM ingest_requests) AS empty',
    )
  ).rows[0];
  if (!counts?.empty)
    throw new Error('Storage measurement refuses existing application data');
}

/** Uses only core read-only SQL; WAL directory permission is required, never auto-granted. */
export async function storageSnapshot(pool: Pool): Promise<StorageSnapshot> {
  const head = (
    await pool.query<{
      observedAt: string;
      serverStartedAt: string;
      databaseBytes: string;
      walRetainedBytes: string;
      walInsertLsn: string;
    }>(`SELECT clock_timestamp()::text AS "observedAt",pg_postmaster_start_time()::text AS "serverStartedAt",
    pg_database_size(current_database())::text AS "databaseBytes",
    (SELECT coalesce(sum(size),0)::text FROM pg_ls_waldir()) AS "walRetainedBytes",
    pg_current_wal_insert_lsn()::text AS "walInsertLsn"`)
  ).rows[0];
  if (!head) throw new Error('Missing storage snapshot');
  const relations = (
    await pool.query<StorageRelation>(`SELECT n.nspname AS schema,c.relname AS name,
    pg_relation_size(c.oid)::text AS "mainForkBytes",pg_table_size(c.oid)::text AS "tableBytes",
    pg_indexes_size(c.oid)::text AS "indexBytes",pg_total_relation_size(c.oid)::text AS "totalBytes"
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname`)
  ).rows;
  return { ...head, relations };
}

/** Calculates exact bytes, keeping generated WAL separate from retained WAL. */
export function storageSummary(
  before: StorageSnapshot,
  after: StorageSnapshot | null,
  walGeneratedBytes: string | null,
) {
  if (after && before.serverStartedAt !== after.serverStartedAt)
    throw new Error('PostgreSQL restarted during storage measurement');
  if (walGeneratedBytes !== null && BigInt(walGeneratedBytes) < 0n)
    throw new Error('WAL insert position moved backwards');
  return {
    databaseGrowthBytes: after
      ? (BigInt(after.databaseBytes) - BigInt(before.databaseBytes)).toString()
      : null,
    walRetainedGrowthBytes: after
      ? (
          BigInt(after.walRetainedBytes) - BigInt(before.walRetainedBytes)
        ).toString()
      : null,
    walGeneratedBytes,
    databasePlusClusterWalBytes: after
      ? (
          BigInt(after.databaseBytes) + BigInt(after.walRetainedBytes)
        ).toString()
      : null,
  };
}

/** Renders endpoint evidence and failures without a fabricated storage-compliance verdict. */
export function storageMarkdown(
  before: StorageSnapshot,
  after: StorageSnapshot | null,
  generated: string | null,
  error: string | null,
): string {
  const summary = storageSummary(before, after, generated);
  const bytes = (value: string | null | undefined): string =>
    value === null || value === undefined
      ? 'unavailable'
      : `${value} bytes (${(Number(value) / 1048576).toFixed(2)} MiB)`;
  return (
    '# Storage and WAL report\n\n' +
    `Status: ${error ? `FAILED — ${error}` : 'load and storage capture completed'}.\n\n` +
    '| Metric | Before | After |\n|---|---:|---:|\n' +
    `| Database size | ${bytes(before.databaseBytes)} | ${bytes(after?.databaseBytes)} |\n` +
    `| Cluster WAL retained | ${bytes(before.walRetainedBytes)} | ${bytes(after?.walRetainedBytes)} |\n\n` +
    `Database growth: ${bytes(summary.databaseGrowthBytes)}.\n\nCluster WAL generated in interval: ${bytes(generated)}.\n\nRetained WAL change: ${bytes(summary.walRetainedGrowthBytes)}.\n\nDatabase plus cluster-retained WAL after: ${bytes(summary.databasePlusClusterWalBytes)}.\n\n` +
    '| After-load relation | Main fork bytes | Table including TOAST/forks bytes | Index bytes | Total bytes |\n|---|---:|---:|---:|---:|\n' +
    (after
      ? after.relations
          .map(
            (row) =>
              `| ${row.schema}.${row.name} | ${row.mainForkBytes} | ${row.tableBytes} | ${row.indexBytes} | ${row.totalBytes} |`,
          )
          .join('\n')
      : '| unavailable | unavailable | unavailable | unavailable | unavailable |') +
    '\n\nScope: after migrations/API startup through series creation, cold load and reconciliation. Sizes are endpoint snapshots, not peak usage. WAL is cluster-wide, including background maintenance; the operator confirms no other workloads. Generated WAL is not retained disk usage. Database plus WAL includes existing cluster WAL, excludes other databases/shared files, and is not a total-cluster or attributable-per-database figure. The rough 500 MB PDF guideline is not a hard pass/fail target. No checkpoint/vacuum, cleanup or settings changes performed. Exact bytes are authoritative; MiB is display-only. See [JSON](report.json) for snapshots and load evidence.\n'
  );
}

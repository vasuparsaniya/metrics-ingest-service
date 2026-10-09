import { Pool } from 'pg';

/** The only supported physical index configurations in this isolated experiment. */
export type IndexHttpVariant = 'indexed' | 'unindexed';

/** Actual catalog definitions captured before and after benchmark traffic. */
export interface IndexHttpSchemaSnapshot {
  variant: IndexHttpVariant;
  indexes: {
    table: string;
    name: string;
    definition: string;
    primary: boolean;
    unique: boolean;
  }[];
  constraints: {
    table: string;
    name: string;
    type: string;
    definition: string;
  }[];
  columns: { table: string; name: string; type: string; notNull: boolean }[];
}

/** Refuses nonlocal URLs, unsafe names, and any collision with the main database. */
export function guardIndexHttpDatabase(
  databaseUrl: string,
  mainDatabaseUrl?: string,
): string {
  const url = new URL(databaseUrl);
  const name = decodeURIComponent(url.pathname.slice(1));
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.search !== '' ||
    !/^metrics_index_http_[A-Za-z0-9_]+$/.test(name) ||
    name.length > 63
  ) {
    throw new Error(
      'Index HTTP experiment requires a local metrics_index_http_ database name of at most 63 characters',
    );
  }
  if (
    mainDatabaseUrl &&
    decodeURIComponent(new URL(mainDatabaseUrl).pathname.slice(1)) === name
  )
    throw new Error(
      'Index HTTP experiment database must differ from the main database',
    );
  return name;
}

/** Reads and verifies all business-table indexes, constraints, and nullability. */
export async function assertIndexHttpSchema(
  pool: Pool,
  variant: IndexHttpVariant,
): Promise<IndexHttpSchemaSnapshot> {
  if (variant !== 'indexed' && variant !== 'unindexed')
    throw new Error('Unknown index HTTP variant');
  const tables = ['ingest_requests', 'measurements', 'series'];
  const indexes = await pool.query<IndexHttpSchemaSnapshot['indexes'][number]>(
    `SELECT t.relname AS "table", i.relname AS name, pg_get_indexdef(i.oid) AS definition, x.indisprimary AS primary, x.indisunique AS unique FROM pg_index x JOIN pg_class t ON t.oid=x.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace JOIN pg_class i ON i.oid=x.indexrelid WHERE n.nspname='public' AND t.relname=ANY($1::text[]) ORDER BY t.relname,i.relname`,
    [tables],
  );
  const constraints = await pool.query<
    IndexHttpSchemaSnapshot['constraints'][number]
  >(
    `SELECT t.relname AS "table", c.conname AS name, c.contype::text AS type, pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname=ANY($1::text[]) ORDER BY t.relname,c.conname`,
    [tables],
  );
  const columns = await pool.query<IndexHttpSchemaSnapshot['columns'][number]>(
    `SELECT t.relname AS "table", a.attname AS name, format_type(a.atttypid,a.atttypmod) AS type, a.attnotnull AS "notNull" FROM pg_attribute a JOIN pg_class t ON t.oid=a.attrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname=ANY($1::text[]) AND a.attnum>0 AND NOT a.attisdropped ORDER BY t.relname,a.attnum`,
    [tables],
  );
  const expectedColumns = [
    ['ingest_requests', 'idempotency_key', 'character varying(128)', true],
    ['ingest_requests', 'payload_hash', 'bytea', true],
    ['ingest_requests', 'response_body', 'jsonb', false],
    ['measurements', 'series_id', 'bigint', true],
    ['measurements', 'ts', 'timestamp with time zone', true],
    ['measurements', 'value', 'numeric', true],
    ['series', 'id', 'bigint', true],
    ['series', 'name', 'character varying(200)', true],
  ];
  if (
    JSON.stringify(
      columns.rows.map((row) => [row.table, row.name, row.type, row.notNull]),
    ) !== JSON.stringify(expectedColumns)
  )
    throw new Error(
      'Index HTTP schema columns or nullability differ from the expected migrations',
    );
  const checks = constraints.rows.filter((row) => row.type === 'c');
  const expectedChecks = [
    'ingest_requests_idempotency_key_check',
    'ingest_requests_payload_hash_check',
    'ingest_requests_response_body_check',
    'measurements_ts_check',
    'measurements_value_check',
    'series_name_check',
  ];
  const expectedDefinitions = [
    "CHECK (((idempotency_key)::text ~ '^[!-~]{1,128}$'::text))",
    'CHECK ((octet_length(payload_hash) = 32))',
    "CHECK (((response_body IS NULL) OR (jsonb_typeof(response_body) = 'object'::text)))",
    'CHECK (isfinite(ts))',
    "CHECK ((value <> ALL (ARRAY['NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric])))",
    'CHECK (((char_length((name)::text) >= 1) AND (char_length((name)::text) <= 200)))',
  ];
  if (
    JSON.stringify(checks.map((row) => row.name)) !==
      JSON.stringify(expectedChecks) ||
    JSON.stringify(checks.map((row) => row.definition)) !==
      JSON.stringify(expectedDefinitions)
  )
    throw new Error(
      'Index HTTP schema check constraints differ from the expected migrations',
    );
  const primary = constraints.rows.filter((row) => row.type === 'p');
  const expectedPrimary =
    variant === 'indexed' ? tables.map((table) => `${table}_pkey`) : [];
  const expectedPrimaryDefinitions =
    variant === 'indexed'
      ? [
          'PRIMARY KEY (idempotency_key)',
          'PRIMARY KEY (series_id, ts)',
          'PRIMARY KEY (id)',
        ]
      : [];
  if (
    JSON.stringify(primary.map((row) => row.name)) !==
      JSON.stringify(expectedPrimary) ||
    JSON.stringify(primary.map((row) => row.definition)) !==
      JSON.stringify(expectedPrimaryDefinitions) ||
    constraints.rows.some((row) => row.type !== 'p' && row.type !== 'c') ||
    indexes.rows.length !== expectedPrimary.length ||
    indexes.rows.some(
      (row) => !row.primary || !row.unique || row.name !== `${row.table}_pkey`,
    )
  )
    throw new Error('Index HTTP schema has unexpected indexes or constraints');
  return {
    variant,
    indexes: indexes.rows,
    constraints: constraints.rows,
    columns: columns.rows,
  };
}

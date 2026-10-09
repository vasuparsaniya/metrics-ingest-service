/** Validated runtime settings shared by the application and database tools. */
export interface Environment {
  port: number;
  databaseUrl: string;
  apiToken: string;
  poolMax: number;
  connectTimeoutMs: number;
  statementTimeoutMs: number;
}

function integer(
  value: string | undefined,
  fallback: number,
  name: string,
  max: number,
): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value))
    throw new Error(`${name} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
    throw new Error(`${name} must be between 1 and ${max}`);
  }
  return parsed;
}

/** Rejects missing or malformed settings before the HTTP server starts. */
export function readEnvironment(source: NodeJS.ProcessEnv): Environment {
  const databaseUrl = source.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const url = new URL(databaseUrl);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.hostname ||
    url.pathname === '/'
  ) {
    throw new Error('DATABASE_URL must identify a PostgreSQL database');
  }
  const apiToken = source.API_TOKEN;
  if (!apiToken || apiToken.trim() !== apiToken || /\s/.test(apiToken)) {
    throw new Error('API_TOKEN is required and must not contain whitespace');
  }
  return {
    port: integer(source.PORT, 3000, 'PORT', 65535),
    databaseUrl,
    apiToken,
    poolMax: integer(source.DB_POOL_MAX, 12, 'DB_POOL_MAX', 100),
    connectTimeoutMs: integer(
      source.DB_CONNECT_TIMEOUT_MS,
      2000,
      'DB_CONNECT_TIMEOUT_MS',
      60000,
    ),
    statementTimeoutMs: integer(
      source.DB_STATEMENT_TIMEOUT_MS,
      5000,
      'DB_STATEMENT_TIMEOUT_MS',
      600000,
    ),
  };
}

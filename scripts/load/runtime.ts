import { ChildProcess, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdir, access } from 'node:fs/promises';
import { openSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import { cpus, totalmem, platform, release } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { applyMigrations } from '../migrate';
import { ApiClient } from './http';
import { postgresSessionOptions } from '../../src/database/session-options';
import { saveCpuProfile } from './cpu-profile';

/** Uses the configured database unless an explicit name override is supplied. */
export function benchmarkUrl(
  source: NodeJS.ProcessEnv,
  database?: string,
): string {
  const base = source.DATABASE_URL;
  if (!base) throw new Error('Set DATABASE_URL');
  const url = new URL(base);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.hostname ||
    url.pathname.length < 2
  )
    throw new Error('DATABASE_URL must identify a PostgreSQL database');
  if (database !== undefined) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(database))
      throw new Error('Invalid database name override');
    url.pathname = `/${database}`;
  }
  return url.toString();
}

/** Default needs no administrative access; explicit local overrides may create a database. */
export async function prepareDatabase(
  databaseUrl: string,
  createIfMissing = false,
): Promise<Pool> {
  const url = new URL(databaseUrl);
  const name = url.pathname.slice(1);
  if (createIfMissing) {
    if (
      !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(name) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    )
      throw new Error(
        'Automatic database creation requires a local server and a valid database name',
      );
    const adminUrl = new URL(url);
    adminUrl.pathname = '/postgres';
    const admin = new Pool({ connectionString: adminUrl.toString(), max: 1 });
    try {
      const exists = await admin.query(
        'SELECT 1 FROM pg_database WHERE datname = $1',
        [name],
      );
      if (exists.rowCount === 0) await admin.query(`CREATE DATABASE "${name}"`);
    } finally {
      await admin.end();
    }
  }
  await applyMigrations(databaseUrl);
  return new Pool({
    connectionString: databaseUrl,
    max: 2,
    options: postgresSessionOptions,
  });
}

/** A compiled API process whose PID belongs solely to this tool. */
export interface ManagedServer {
  child: ChildProcess;
  api: ApiClient;
  exited: Promise<void>;
  forcedKill: boolean;
  cpuProfilePath?: string;
  stop(): Promise<void>;
}

/** Launches the compiled API on a free local port and saves payload-free logs. */
export async function startServer(
  databaseUrl: string,
  logPath: string,
  cpuProfilePath?: string,
): Promise<ManagedServer> {
  await access(resolve('dist/main.js'));
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const address = socket.address();
  if (!address || typeof address === 'string')
    throw new Error('Could not allocate API port');
  await new Promise<void>((done, fail) =>
    socket.close((error) => (error ? fail(error) : done())),
  );
  await mkdir(resolve(logPath, '..'), { recursive: true });
  const log = openSync(logPath, 'wx');
  const token = process.env.API_TOKEN;
  if (!token) {
    closeSync(log);
    throw new Error('API_TOKEN is required');
  }
  const child = spawn(
    process.execPath,
    [
      '--require',
      resolve('dist/benchmark/rss-preload.js'),
      ...(cpuProfilePath
        ? ['--require', resolve('dist/benchmark/cpu-profile-preload.js')]
        : []),
      resolve('dist/main.js'),
    ],
    {
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        PORT: String(address.port),
        API_TOKEN: token,
        ...(cpuProfilePath
          ? { METRICS_BENCHMARK_CPU_PROFILE_PATH: cpuProfilePath }
          : {}),
      },
      stdio: ['ignore', log, log, 'ipc'],
    },
  );
  closeSync(log);
  const exited = new Promise<void>((done, fail) => {
    child.once('exit', () => done());
    child.once('error', fail);
  });
  let profileSaved = false;
  const server: ManagedServer = {
    child,
    api: new ApiClient(`http://127.0.0.1:${address.port}`, token),
    exited,
    forcedKill: false,
    cpuProfilePath,
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) {
        if (cpuProfilePath && !profileSaved)
          throw new Error('API exited before CPU profile was saved');
        return;
      }
      let profileError: Error | undefined;
      if (cpuProfilePath) {
        try {
          await saveCpuProfile(child, cpuProfilePath);
          profileSaved = true;
        } catch (error: unknown) {
          profileError =
            error instanceof Error ? error : new Error(String(error));
        }
      }
      child.kill('SIGTERM');
      const timeout = setTimeout(() => {
        server.forcedKill = true;
        child.kill('SIGKILL');
      }, 20000);
      try {
        await exited;
      } finally {
        clearTimeout(timeout);
      }
      if (profileError) throw profileError;
    },
  };
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null || child.signalCode !== null) break;
    try {
      const response = await fetch(`${server.api.url}/readyz`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(500),
      });
      await response.arrayBuffer();
      if (response.ok) return server;
    } catch (error: unknown) {
      if (typeof error !== 'object' || error === null || !('message' in error))
        throw error;
      // Startup connection failures are expected while the child begins listening.
    }
    await delay(100);
  }
  await server.stop();
  throw new Error(`API failed to become ready; inspect ${logPath}`);
}

/** Captures the actual host and PostgreSQL runtime rather than hard-coded version claims. */
export async function machine(pool: Pool): Promise<object> {
  const version = await pool.query<{ version: string }>('SELECT version()');
  const jit = await pool.query<{ jit: string }>('SHOW jit');
  let postgresInDocker: boolean | null = null;
  let dockerDetectionError: string | null = null;
  try {
    const docker = await pool.query<{ docker: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM pg_ls_dir('/') AS path WHERE path = '.dockerenv') AS docker",
    );
    postgresInDocker = docker.rows[0]?.docker ?? null;
  } catch (error: unknown) {
    dockerDetectionError =
      error instanceof Error ? error.message : String(error);
  }
  return {
    cpu: cpus()[0]?.model ?? 'unknown',
    logicalCpus: cpus().length,
    ramBytes: totalmem(),
    os: `${platform()} ${release()}`,
    node: process.version,
    postgres: version.rows[0]?.version,
    postgresJit: jit.rows[0]?.jit,
    postgresInDocker,
    dockerDetectionError,
    poolMax: Number(process.env.DB_POOL_MAX ?? 12),
    application: 'compiled dist/main.js; one managed Node.js process',
  };
}

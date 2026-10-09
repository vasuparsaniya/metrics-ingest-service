import { ChildProcess, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

/** A real application process used to exercise SIGTERM and persistent replay. */
export interface ServerProcess {
  process: ChildProcess;
  url: string;
  exit: Promise<void>;
}

/** Starts the application on an ephemeral local port against the isolated test database. */
export async function startServer(
  databaseUrl: string,
  token: string,
): Promise<ServerProcess> {
  const portServer = createServer();
  portServer.listen(0, '127.0.0.1');
  await once(portServer, 'listening');
  const address = portServer.address();
  if (!address || typeof address === 'string')
    throw new Error('Could not allocate a test port');
  await new Promise<void>((resolve, reject) =>
    portServer.close((error) => (error ? reject(error) : resolve())),
  );
  const child = spawn(
    process.execPath,
    ['-r', 'ts-node/register', 'src/main.ts'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        API_TOKEN: token,
        PORT: String(address.port),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let diagnostics = '';
  const capture = (chunk: Buffer): void => {
    diagnostics = (diagnostics + chunk.toString()).slice(-4000);
  };
  child.stdout?.on('data', capture);
  child.stderr?.on('data', capture);
  const exit = new Promise<void>((resolve, reject) => {
    child.once('exit', () => resolve());
    child.once('error', reject);
  });
  const url = `http://127.0.0.1:${address.port}`;
  const deadline = Date.now() + 20000;
  while (
    Date.now() < deadline &&
    child.exitCode === null &&
    child.signalCode === null
  ) {
    try {
      const response = await fetch(`${url}/readyz`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(500),
      });
      await response.arrayBuffer();
      if (response.ok) return { process: child, url, exit };
    } catch (error: unknown) {
      if (typeof error !== 'object' || error === null || !('message' in error))
        throw error;
      diagnostics = (diagnostics + String(error.message)).slice(-4000);
    }
    await delay(50);
  }
  child.kill('SIGTERM');
  await exit;
  throw new Error(`Application process did not become ready: ${diagnostics}`);
}

/** Terminates the test application and waits for graceful shutdown. */
export async function stopServer(server: ServerProcess): Promise<void> {
  server.process.kill('SIGTERM');
  await server.exit;
}

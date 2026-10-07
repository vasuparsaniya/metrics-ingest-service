import 'dotenv/config';
import { parse } from 'dotenv';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

function command(program: string, args: string[]): Promise<void> {
  return new Promise((done, fail) => {
    const child = spawn(program, args, { stdio: 'inherit', env: process.env });
    child.once('error', fail);
    child.once('exit', (code, signal) =>
      code === 0
        ? done()
        : fail(new Error(`${program} failed with ${signal ?? code}`)),
    );
  });
}

/** Invokes the npm JavaScript CLI directly, including Windows and paths with spaces. */
export function npmInvocation(source: NodeJS.ProcessEnv = process.env) {
  const cli = source.npm_execpath;
  if (!cli)
    throw new Error(
      'Run this setup through npm run load:setup so npm_execpath is available',
    );
  return { program: process.execPath, args: [cli, 'run', 'load'] };
}

/** Provides a clean-clone load command without overwriting an existing .env file. */
export async function main(): Promise<void> {
  const defaults = parse(await readFile('.env.example'));
  for (const [key, value] of Object.entries(defaults))
    if (process.env[key] === undefined) process.env[key] = value;
  await command('docker', ['compose', 'up', '-d', '--wait']);
  const npm = npmInvocation();
  await command(npm.program, [...npm.args, '--', ...process.argv.slice(2)]);
}

if (require.main === module)
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });

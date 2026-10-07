import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { Pool } from 'pg';
import { options } from './load/options';
import { benchmarkUrl, machine } from './load/runtime';
import { readManifest, artifact } from './load/manifest';
import { verifyOwnership } from './load/runner';
import { compare } from './load/compare';

/** Produces actual SQL plans and measured strategy/index evidence without business-table writes. */
export async function main(): Promise<void> {
  const settings = options();
  if (settings.help) {
    console.log(
      'npm run compare -- --manifest artifacts/<run>/manifest.json [--database name]\nRetains three experimental copies. Never drops production indexes.',
    );
    return;
  }
  if (!settings.manifest) throw new Error('--manifest is required');
  const manifest = await readManifest(settings.manifest);
  const pool = new Pool({
    connectionString: benchmarkUrl(process.env, settings.database),
    max: 8,
    options: '-c timezone=UTC',
  });
  const path = resolve(
    dirname(settings.manifest),
    `comparison-${Date.now()}-${randomUUID()}.json`,
  );
  try {
    await verifyOwnership(pool, manifest);
    const result = await compare(pool, manifest);
    await artifact(path, {
      kind: 'comparison',
      measuredAt: new Date().toISOString(),
      runId: manifest.runId,
      machine: await machine(pool),
      ...result,
    });
    console.log(JSON.stringify({ event: 'comparison_report', path }));
  } catch (error: unknown) {
    await artifact(path, {
      kind: 'comparison',
      passed: false,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    await pool.end();
  }
}

if (require.main === module)
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });

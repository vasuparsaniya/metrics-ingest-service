import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { Pool } from 'pg';
import { options } from './load/options';
import { benchmarkUrl, machine } from './load/runtime';
import { readManifest, artifact } from './load/manifest';
import { verifyOwnership } from './load/runner';
import { compare } from './load/compare';
import { generateComparisonReport } from './load/comparison-report';
import { postgresSessionOptions } from '../src/database/session-options';

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
  const databaseUrl = benchmarkUrl(process.env, settings.database);
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 8,
    options: postgresSessionOptions,
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
      database: new URL(databaseUrl).pathname.slice(1),
      settings: {
        points: manifest.total,
        batchSize: manifest.batchSize,
        writers: manifest.writers,
      },
      comparisonPoolMax: 8,
      machine: await machine(pool),
      ...result,
    });
  } catch (error: unknown) {
    await artifact(path, {
      kind: 'comparison',
      runId: manifest.runId,
      database: new URL(databaseUrl).pathname.slice(1),
      measuredAt: new Date().toISOString(),
      passed: false,
      error: error instanceof Error ? error.message : String(error),
    });
    const markdownPath = await generateComparisonReport(path);
    console.log(
      JSON.stringify({
        event: 'comparison_report',
        path,
        markdownPath,
        passed: false,
      }),
    );
    throw error;
  } finally {
    await pool.end();
  }
  const markdownPath = await generateComparisonReport(path);
  console.log(
    JSON.stringify({ event: 'comparison_report', path, markdownPath }),
  );
}

if (require.main === module)
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });

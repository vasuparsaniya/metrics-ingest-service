import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { postgresSessionOptions } from '../src/database/session-options';
import { options } from './load/options';
import { benchmarkUrl, machine } from './load/runtime';
import { artifact, readManifest } from './load/manifest';
import { expectations } from './load/generator';
import {
  primaryIndexCost,
  primaryIndexMarkdown,
} from './load/primary-index-cost';

/** Runs a guarded diagnostic without changing or inserting into business tables. */
export async function main(): Promise<void> {
  const settings = options();
  if (settings.help) {
    console.log(
      'npm run index:cost -- --manifest <path> --database <existing-local-test-db> [--points 40000]',
    );
    return;
  }
  if (!settings.manifest || !settings.database)
    throw new Error('--manifest and an explicit --database are required');
  const url = new URL(benchmarkUrl(process.env, settings.database));
  const base = new URL(benchmarkUrl(process.env));
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.pathname === base.pathname
  )
    throw new Error(
      'Use an existing local database other than the main environment database',
    );
  const source = await readManifest(settings.manifest);
  const manifest = {
    ...source,
    total: Math.min(source.total, settings.points),
    expected: source.expected,
  };
  manifest.expected = expectations(manifest);
  const pool = new Pool({
    connectionString: url.toString(),
    max: 8,
    options: `${postgresSessionOptions} -c statement_timeout=30000 -c lock_timeout=2000`,
  });
  try {
    const result = await primaryIndexCost(pool, manifest);
    const directory = resolve(
      settings.reportDir,
      `primary-index-cost-${randomUUID()}`,
    );
    await mkdir(directory, { recursive: true });
    const path = resolve(directory, 'report.json');
    await artifact(path, {
      kind: 'primary-index-cost',
      measuredAt: new Date().toISOString(),
      database: settings.database,
      sourceManifest: settings.manifest,
      settings: {
        points: manifest.total,
        batchSize: manifest.batchSize,
        writers: manifest.writers,
      },
      machine: {
        ...(await machine(pool)),
        poolMax: 8,
        application: 'ts-node direct SQL diagnostic; no managed API process',
      },
      methodology:
        'Sequential PK-first plain UNNEST direct write kernel; identical generation/driver overhead included; DDL/reconciliation excluded; no HTTP/read load',
      ...result,
    });
    const markdownPath = resolve(directory, 'REPORT.md');
    await writeFile(markdownPath, primaryIndexMarkdown(result), { flag: 'wx' });
    console.log(
      JSON.stringify({
        event: 'primary_index_cost_report',
        path,
        markdownPath,
        withPrimaryKey: result.withPrimaryKey.pointsPerSecond,
        withoutPrimaryKey: result.withoutPrimaryKey.pointsPerSecond,
      }),
    );
  } finally {
    await pool.end();
  }
}

if (require.main === module)
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });

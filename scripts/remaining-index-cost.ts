import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { postgresSessionOptions } from '../src/database/session-options';
import { artifact } from './load/manifest';
import { options } from './load/options';
import { benchmarkUrl, machine } from './load/runtime';
import {
  remainingIndexCost,
  remainingIndexMarkdown,
} from './load/remaining-index-cost';

/** Runs only local isolated synthetic comparisons; never starts the API. */
export async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const settings = options(
    args.includes('--points') ? args : [...args, '--points', '100000'],
  );
  if (settings.help) {
    console.log(
      'npm run index:cost:remaining -- --database <existing-local-test-db> [--points 100000]',
    );
    return;
  }
  if (!settings.database || settings.manifest || settings.profileApi)
    throw new Error(
      'Explicit --database required; no manifest/profile supported',
    );
  const url = new URL(benchmarkUrl(process.env, settings.database));
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.pathname === new URL(benchmarkUrl(process.env)).pathname
  )
    throw new Error(
      'Use an existing local database other than the main environment database',
    );
  const pool = new Pool({
    connectionString: url.toString(),
    max: 8,
    options: `${postgresSessionOptions} -c statement_timeout=30000 -c lock_timeout=2000`,
  });
  try {
    const results = await remainingIndexCost(pool, settings.points);
    const directory = resolve(
      settings.reportDir,
      `remaining-index-cost-${randomUUID()}`,
    );
    await mkdir(directory, { recursive: true });
    const path = resolve(directory, 'report.json');
    const markdownPath = resolve(directory, 'REPORT.md');
    await artifact(path, {
      kind: 'remaining-index-cost',
      measuredAt: new Date().toISOString(),
      database: settings.database,
      settings: {
        syntheticRowsPerVariant: settings.points,
        batchSize: 5000,
        writers: 8,
      },
      machine: {
        ...(await machine(pool)),
        poolMax: 8,
        application: 'ts-node direct SQL diagnostic; no API process',
      },
      methodology:
        'Synthetic indexed-first sequential plain INSERT comparisons; driver/generation included; DDL/verification excluded. Not HTTP acceptance.',
      results,
    });
    await writeFile(markdownPath, remainingIndexMarkdown(results), {
      flag: 'wx',
    });
    console.log(
      JSON.stringify({
        event: 'remaining_index_cost_report',
        path,
        markdownPath,
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

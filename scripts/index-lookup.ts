import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { postgresSessionOptions } from '../src/database/session-options';
import { options } from './load/options';
import { artifact } from './load/manifest';
import { benchmarkUrl, machine } from './load/runtime';
import {
  compareLookups,
  lookupMarkdown,
  lookupPairs,
} from './load/index-lookup';

/** Reuses owned cost-test tables for real indexed/unindexed lookup plans. */
export async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const keysIndex = args.indexOf('--keys-report');
  const keysPath = keysIndex < 0 ? undefined : args[keysIndex + 1];
  if (keysIndex >= 0) args.splice(keysIndex, 2);
  const settings = options(args);
  if (settings.help) {
    console.log(
      'npm run index:plans -- --database <local-test-db> --manifest <primary-cost-report.json> --keys-report <remaining-cost-report.json>',
    );
    return;
  }
  if (
    !settings.database ||
    !settings.manifest ||
    !keysPath ||
    keysPath.startsWith('--')
  )
    throw new Error(
      '--database, --manifest primary cost report and --keys-report are required',
    );
  const url = new URL(benchmarkUrl(process.env, settings.database));
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.pathname === new URL(benchmarkUrl(process.env)).pathname
  )
    throw new Error(
      'Use a local database other than the main environment database',
    );
  const primary: unknown = JSON.parse(
    await readFile(settings.manifest, 'utf8'),
  );
  const keys: unknown = JSON.parse(await readFile(keysPath, 'utf8'));
  const pairs = lookupPairs(primary, keys);
  const pool = new Pool({
    connectionString: url.toString(),
    max: 1,
    options: `${postgresSessionOptions} -c statement_timeout=30000 -c lock_timeout=2000`,
  });
  try {
    const evidence = await compareLookups(pool, pairs);
    const directory = resolve(
      settings.reportDir,
      `index-lookups-${randomUUID()}`,
    );
    await mkdir(directory, { recursive: true });
    const path = resolve(directory, 'report.json');
    const markdownPath = resolve(directory, 'REPORT.md');
    await artifact(path, {
      kind: 'index-lookup-plans',
      measuredAt: new Date().toISOString(),
      database: settings.database,
      sources: { primary: settings.manifest, keys: keysPath },
      machine: {
        ...(await machine(pool)),
        poolMax: 1,
        application:
          'ts-node sequential direct SQL lookup diagnostic; no API process',
      },
      evidence,
    });
    await writeFile(markdownPath, lookupMarkdown(evidence), { flag: 'wx' });
    console.log(
      JSON.stringify({ event: 'index_lookup_report', path, markdownPath }),
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

import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { options } from './load/options';
import { benchmarkUrl, prepareDatabase, startServer } from './load/runtime';
import { createManifest, readManifest } from './load/manifest';
import { requireEmptyMeasurements, runLoad } from './load/runner';

/** Runs the PDF load or replays the original persisted manifest without external services. */
export async function main(): Promise<void> {
  const settings = options(process.argv.slice(2), true);
  if (settings.help) {
    console.log(
      'npm run load -- [--points 2000000] [--database name] [--manifest path] [--report-dir artifacts] [--profile-api]\nDefault: DATABASE_URL, 5000-point batches, 8 writers. Profiling is diagnostic only. Never deletes existing data.',
    );
    return;
  }
  const databaseUrl = benchmarkUrl(process.env, settings.database);
  const pool = await prepareDatabase(
    databaseUrl,
    settings.database !== undefined,
  );
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  const cpuProfilePath = settings.profileApi
    ? resolve(settings.reportDir, `api-${randomUUID()}.cpuprofile`)
    : undefined;
  try {
    if (!settings.manifest) await requireEmptyMeasurements(pool);
    server = await startServer(
      databaseUrl,
      resolve(settings.reportDir, `api-${randomUUID()}.log`),
      cpuProfilePath,
    );
    const prepared = settings.manifest
      ? {
          manifest: await readManifest(settings.manifest),
          path: settings.manifest,
        }
      : await createManifest(server.api, settings.points, settings.reportDir);
    console.log(
      JSON.stringify({
        event: 'load_start',
        database: new URL(databaseUrl).pathname.slice(1),
        points: prepared.manifest.total,
        manifestPath: prepared.path,
        ...(cpuProfilePath ? { cpuProfilePath, diagnosticOnly: true } : {}),
      }),
    );
    await runLoad(pool, server, prepared.manifest, prepared.path);
  } finally {
    try {
      await server?.stop();
      if (cpuProfilePath && server)
        console.log(
          JSON.stringify({
            event: 'cpu_profile_saved',
            path: cpuProfilePath,
            diagnosticOnly: true,
          }),
        );
    } finally {
      await pool.end();
    }
  }
}

if (require.main === module)
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });

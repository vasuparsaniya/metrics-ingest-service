import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { isRecord } from '../../src/ingest/ingest.validation';
import { expectations } from './generator';
import { ApiClient } from './http';
import { requestMetrics } from './metrics';
import { LoadManifest } from './types';

/** Writes a new JSON artifact without overwriting a previous result. */
export async function artifact(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(resolve(path)), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
}

/** Creates API-owned series and persists deterministic generation parameters. */
export async function createManifest(
  api: ApiClient,
  total: number,
  directory = 'artifacts',
): Promise<{ manifest: LoadManifest; path: string }> {
  const runId = randomUUID();
  const seriesIds: string[] = [];
  for (let index = 0; index < 8; index += 1) {
    const response = await api.request('/v1/series', requestMetrics(), {
      name: `load:${runId}:${index}`,
    });
    if (!isRecord(response) || typeof response.seriesId !== 'string')
      throw new Error('Series creation returned an invalid ID');
    seriesIds.push(response.seriesId);
  }
  const manifest: LoadManifest = {
    version: 1,
    runId,
    createdAt: new Date().toISOString(),
    total,
    batchSize: 5000,
    writers: 8,
    from: '2026-09-01T00:00:00.000Z',
    to: '2026-10-01T00:00:00.000Z',
    seriesIds,
    expected: [],
  };
  manifest.expected = expectations(manifest);
  const path = resolve(directory, runId, 'manifest.json');
  await artifact(path, manifest);
  return { manifest, path };
}

/** Rejects corrupt manifests instead of silently replaying different data. */
export async function readManifest(path: string): Promise<LoadManifest> {
  const value: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.runId !== 'string' ||
    !/^[a-f0-9-]{36}$/.test(value.runId) ||
    typeof value.createdAt !== 'string' ||
    typeof value.total !== 'number' ||
    !Number.isSafeInteger(value.total) ||
    value.total < 8 ||
    value.total > 2000000 ||
    value.batchSize !== 5000 ||
    value.writers !== 8 ||
    value.from !== '2026-09-01T00:00:00.000Z' ||
    value.to !== '2026-10-01T00:00:00.000Z' ||
    !Array.isArray(value.seriesIds) ||
    value.seriesIds.length !== 8 ||
    !value.seriesIds.every(
      (id: unknown) => typeof id === 'string' && /^[1-9]\d*$/.test(id),
    ) ||
    new Set(value.seriesIds).size !== 8 ||
    !Array.isArray(value.expected)
  )
    throw new Error('Invalid or incompatible load manifest');
  const manifest: LoadManifest = {
    version: 1,
    runId: value.runId,
    createdAt: value.createdAt,
    total: value.total,
    batchSize: 5000,
    writers: 8,
    from: value.from,
    to: value.to,
    seriesIds: value.seriesIds as string[],
    expected: [],
  };
  manifest.expected = expectations(manifest);
  if (JSON.stringify(value.expected) !== JSON.stringify(manifest.expected))
    throw new Error('Manifest expectations do not match generation parameters');
  return manifest;
}

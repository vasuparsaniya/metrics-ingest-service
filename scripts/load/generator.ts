import { GeneratedPoint, LoadManifest } from './types';

/** Renders signed integer cents exactly, including negative values and zero. */
export function centsText(cents: bigint): string {
  const magnitude = cents < 0n ? -cents : cents;
  return `${cents < 0n ? '-' : ''}${magnitude / 100n}.${String(magnitude % 100n).padStart(2, '0')}`;
}

/** Produces one unique, stable point spread evenly over a thirty-day range. */
export function pointAt(manifest: LoadManifest, index: number): GeneratedPoint {
  if (!Number.isInteger(index) || index < 0 || index >= manifest.total)
    throw new Error('Generator index is outside the manifest');
  const seriesIndex = index % manifest.seriesIds.length;
  const seriesId = manifest.seriesIds[seriesIndex];
  if (!seriesId) throw new Error('Generator needs a valid series identity');
  const count =
    Math.floor((manifest.total - 1 - seriesIndex) / manifest.seriesIds.length) +
    1;
  const sequence = Math.floor(index / manifest.seriesIds.length);
  const start = Date.parse(manifest.from);
  const span = Date.parse(manifest.to) - start;
  return {
    seriesId,
    ts: new Date(start + Math.floor((sequence * span) / count)).toISOString(),
    value: centsText(BigInt((index % 2001) - 1000)),
  };
}

/** Generates only the requested batch, not an entire multi-million-row dataset. */
export function batchAt(
  manifest: LoadManifest,
  batch: number,
): GeneratedPoint[] {
  const start = batch * manifest.batchSize;
  if (!Number.isInteger(batch) || batch < 0 || start >= manifest.total)
    throw new Error('Batch index is outside the manifest');
  return Array.from(
    { length: Math.min(manifest.batchSize, manifest.total - start) },
    (_, offset) => pointAt(manifest, start + offset),
  );
}

/** Computes an independent expected count and exact sum for every series. */
export function expectations(manifest: LoadManifest): LoadManifest['expected'] {
  const counts = manifest.seriesIds.map(() => 0);
  const sums = manifest.seriesIds.map(() => 0n);
  for (let index = 0; index < manifest.total; index += 1) {
    const slot = index % manifest.seriesIds.length;
    counts[slot] = (counts[slot] ?? 0) + 1;
    sums[slot] = (sums[slot] ?? 0n) + BigInt((index % 2001) - 1000);
  }
  return manifest.seriesIds.map((seriesId, slot) => ({
    seriesId,
    count: counts[slot] ?? 0,
    sum: centsText(sums[slot] ?? 0n),
  }));
}

/** Derives a stable request key that must survive retries, replay, and restart. */
export function batchKey(manifest: LoadManifest, batch: number): string {
  return `load:${manifest.runId}:${batch}`;
}

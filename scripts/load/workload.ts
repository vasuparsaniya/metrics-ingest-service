import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { ApiClient, ingestResult } from './http';
import { batchAt, batchKey } from './generator';
import { bucketPath } from './reconcile';
import { requestMetrics, summarize, latency } from './metrics';
import { LoadManifest } from './types';

/** Result of a complete or deliberately interrupted HTTP writer run. */
export interface WorkloadResult {
  wallMs: number;
  completedBatches: number;
  returnedAccepted: number;
  returnedDuplicates: number;
  ingest: object;
  reads: {
    latest: ReturnType<typeof summarize>;
    buckets: ReturnType<typeof summarize>;
    latestTargetPass: boolean;
    bucketsTargetPass: boolean;
    sampling: string;
  };
  errors: string[];
}

/** Runs bounded writers and independent reader loops against the same active API. */
export async function workload(
  api: ApiClient,
  manifest: LoadManifest,
  options: {
    reads?: boolean;
    shouldStop?: () => boolean;
    onBatch?: (completed: number) => Promise<void>;
  } = {},
): Promise<WorkloadResult> {
  const ingest = requestMetrics();
  const latest = requestMetrics();
  const buckets = requestMetrics();
  const errors: string[] = [];
  let next = 0;
  let completed = 0;
  let accepted = 0;
  let duplicates = 0;
  let stopped = false;
  let writing = true;
  let readerStop = false;
  const started = performance.now();
  const readLoop = async (kind: 'latest' | 'buckets'): Promise<void> => {
    let index = 0;
    while (!readerStop && writing) {
      const id = manifest.seriesIds[index++ % manifest.seriesIds.length];
      if (!id) throw new Error('Missing reader series');
      try {
        await api.request(
          kind === 'latest'
            ? `/v1/series/${id}/latest`
            : bucketPath(manifest, id),
          kind === 'latest' ? latest : buckets,
          undefined,
          undefined,
          0,
        );
      } catch (error: unknown) {
        if (errors.length < 20)
          errors.push(
            `reader ${kind}: ${error instanceof Error ? error.message : String(error)}`,
          );
      }
      await delay(100);
    }
  };
  const readers =
    options.reads === false ? [] : [readLoop('latest'), readLoop('buckets')];
  const worker = async (): Promise<void> => {
    while (!stopped && !options.shouldStop?.()) {
      const batch = next++;
      if (batch >= Math.ceil(manifest.total / manifest.batchSize)) return;
      const points = batchAt(manifest, batch);
      try {
        const result = ingestResult(
          await api.request(
            '/v1/ingest',
            ingest,
            { points },
            batchKey(manifest, batch),
            options.shouldStop ? 0 : 8,
          ),
        );
        if (
          result.rejected.length ||
          result.accepted + result.duplicates !== points.length
        )
          throw new Error(
            `Valid generated batch ${batch} was not fully accounted for`,
          );
        accepted += result.accepted;
        duplicates += result.duplicates;
        completed += 1;
        await options.onBatch?.(completed);
      } catch (error: unknown) {
        stopped = true;
        if (errors.length < 20)
          errors.push(
            `writer batch ${batch}: ${error instanceof Error ? error.message : String(error)}`,
          );
      }
    }
  };
  await Promise.all(Array.from({ length: manifest.writers }, worker));
  const wallMs = performance.now() - started;
  writing = false;
  readerStop = true;
  await Promise.all(readers);
  return {
    wallMs,
    completedBatches: completed,
    returnedAccepted: accepted,
    returnedDuplicates: duplicates,
    ingest: summarize(ingest),
    errors,
    reads: {
      latest: summarize(latest),
      buckets: summarize(buckets),
      latestTargetPass:
        latest.failed.length === 0 &&
        (latency(latest.success).p95Ms ?? Infinity) <= 50,
      bucketsTargetPass:
        buckets.failed.length === 0 &&
        (latency(buckets.success).p95Ms ?? Infinity) <= 150,
      sampling:
        'one request per category at a time; 100ms pause; initiated while writers are active',
    },
  };
}

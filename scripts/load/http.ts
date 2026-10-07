import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { IngestResponse } from '../../src/ingest/ingest.types';
import { isRecord } from '../../src/ingest/ingest.validation';
import { RequestMetrics } from './types';

/** Narrows ingest responses before using counts as correctness evidence. */
export function ingestResult(value: unknown): IngestResponse {
  if (
    !isRecord(value) ||
    !Number.isSafeInteger(value.accepted) ||
    !Number.isSafeInteger(value.duplicates) ||
    typeof value.accepted !== 'number' ||
    value.accepted < 0 ||
    typeof value.duplicates !== 'number' ||
    value.duplicates < 0 ||
    !Array.isArray(value.rejected)
  )
    throw new Error('Invalid ingest response');
  const rejected = (value.rejected as unknown[]).map((item) => {
    if (
      !isRecord(item) ||
      typeof item.index !== 'number' ||
      !Number.isSafeInteger(item.index) ||
      item.index < 0 ||
      typeof item.reason !== 'string'
    )
      throw new Error('Invalid indexed rejection');
    return { index: item.index, reason: item.reason };
  });
  return { accepted: value.accepted, duplicates: value.duplicates, rejected };
}

/** Calls the API with bounded retry and records every attempt, including failures. */
export class ApiClient {
  constructor(
    readonly url: string,
    private readonly token: string,
  ) {}

  async request(
    path: string,
    metrics: RequestMetrics,
    body?: unknown,
    key?: string,
    maxRetries = 8,
  ): Promise<unknown> {
    const serialized = body === undefined ? undefined : JSON.stringify(body);
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const started = performance.now();
      let response: Response;
      let text: string;
      try {
        response = await fetch(`${this.url}${path}`, {
          method: body === undefined ? 'GET' : 'POST',
          headers: {
            Authorization: `Bearer ${this.token}`,
            ...(body === undefined
              ? {}
              : { 'Content-Type': 'application/json' }),
            ...(key === undefined ? {} : { 'Idempotency-Key': key }),
          },
          body: serialized,
          signal: AbortSignal.timeout(15000),
        });
        text = await response.text();
      } catch (error: unknown) {
        metrics.failed.push(performance.now() - started);
        metrics.statuses.transport = (metrics.statuses.transport ?? 0) + 1;
        if (attempt === maxRetries) throw error;
        metrics.retries += 1;
        await delay(Math.min(100 * 2 ** attempt, 2000));
        continue;
      }
      const elapsed = performance.now() - started;
      metrics.statuses[String(response.status)] =
        (metrics.statuses[String(response.status)] ?? 0) + 1;
      if (response.ok) {
        metrics.success.push(elapsed);
        const parsed: unknown = JSON.parse(text);
        return parsed;
      }
      metrics.failed.push(elapsed);
      if (![429, 503].includes(response.status) || attempt === maxRetries)
        throw new Error(
          `API ${path} returned ${response.status}: ${text.slice(0, 500)}`,
        );
      metrics.retries += 1;
      const retryAfter = Number(response.headers.get('retry-after'));
      await delay(
        Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1000, 30000)
          : Math.min(100 * 2 ** attempt, 2000),
      );
    }
    throw new Error('Retry loop exhausted');
  }
}

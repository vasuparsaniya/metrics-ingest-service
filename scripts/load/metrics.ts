import { LatencySummary, RequestMetrics } from './types';

/** Calculates nearest-rank percentiles from measured end-to-end durations. */
export function latency(samples: readonly number[]): LatencySummary {
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = (fraction: number): number | null =>
    sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? null;
  return {
    samples: sorted.length,
    minMs: sorted[0] ?? null,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    maxMs: sorted[sorted.length - 1] ?? null,
  };
}

/** Allocates fresh request evidence for one measured operation category. */
export function requestMetrics(): RequestMetrics {
  return { success: [], failed: [], statuses: {}, retries: 0 };
}

/** Serializes both successful and failed latency samples with status counts. */
export function summarize(metrics: RequestMetrics) {
  return {
    success: latency(metrics.success),
    failed: latency(metrics.failed),
    statuses: metrics.statuses,
    retries: metrics.retries,
  };
}

/** Computes measured p95 degradation; absent/zero baselines remain explicitly unavailable. */
export function degradation(
  idleMs: number | null,
  busyMs: number | null,
): number | null {
  return idleMs === null || busyMs === null || idleMs <= 0
    ? null
    : (busyMs / idleMs - 1) * 100;
}

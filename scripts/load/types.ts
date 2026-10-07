/** HTTP point representation used by the deterministic load generator. */
export interface GeneratedPoint {
  seriesId: string;
  ts: string;
  value: string;
}

/** Persisted generator parameters and original API-created series identities. */
export interface LoadManifest {
  version: 1;
  runId: string;
  createdAt: string;
  total: number;
  batchSize: number;
  writers: number;
  from: string;
  to: string;
  seriesIds: string[];
  expected: { seriesId: string; count: number; sum: string }[];
}

/** Nearest-rank latency distribution, without concealing failed requests. */
export interface LatencySummary {
  samples: number;
  minMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
}

/** Request-level evidence kept separately for successful and failed attempts. */
export interface RequestMetrics {
  success: number[];
  failed: number[];
  statuses: Record<string, number>;
  retries: number;
}

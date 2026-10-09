/** The result assigned to each rejected input row. */
export interface Rejection {
  index: number;
  reason: string;
}

/** Original ingest outcome persisted for request-level replay. */
export interface IngestResponse {
  accepted: number;
  duplicates: number;
  rejected: Rejection[];
}

/** A valid input point with exact values and an identity-ordering timestamp. */
export interface ValidPoint {
  index: number;
  seriesId: string;
  ts: string;
  micros: bigint;
  value: string;
}

/** Candidate group preserving batch-first precedence and equal occurrence indexes. */
export interface PointGroup {
  point: ValidPoint;
  indexes: number[];
}

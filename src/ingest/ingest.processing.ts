import { setImmediate as yieldToIo } from 'node:timers/promises';
import { Rejection, ValidPoint } from './ingest.types';
import { createPointValidator, validatePoints } from './ingest.validation';

/** Internal scheduling boundary, independent of the 5000-point HTTP/SQL batch size. */
export const processingChunkSize = 100;

/** Preserves original indexes while giving socket and database callbacks time to run. */
export async function validatePointsCooperatively(
  rows: readonly unknown[],
): Promise<{ valid: ValidPoint[]; rejected: Rejection[] }> {
  const valid: ValidPoint[] = [];
  const rejected: Rejection[] = [];
  const normalize = createPointValidator();
  for (let offset = 0; offset < rows.length; offset += processingChunkSize) {
    const result = validatePoints(
      rows.slice(offset, offset + processingChunkSize),
      offset,
      normalize,
    );
    valid.push(...result.valid);
    rejected.push(...result.rejected);
    if (offset + processingChunkSize < rows.length) await yieldToIo();
  }
  return { valid, rejected };
}

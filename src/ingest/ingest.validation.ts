import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { decimal, seriesId } from '../validation/numeric';
import { timestamp } from '../validation/timestamp';
import { PointGroup, Rejection, ValidPoint } from './ingest.types';

/** Narrows untrusted JSON objects without accepting arrays or null. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validates the batch envelope while leaving bad points for indexed rejection. */
export function batchBody(body: unknown): unknown[] {
  if (!isRecord(body) || !Array.isArray(body.points))
    throw new BadRequestException('Body must contain a points array');
  if (body.points.length > 5000)
    throw new PayloadTooLargeException(
      'A batch may contain at most 5000 points',
    );
  return body.points as unknown[];
}

/** Validates exactly one opaque request key from raw HTTP headers. */
export function requestKey(rawHeaders: readonly string[]): string {
  const keys: string[] = [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index]?.toLowerCase() === 'idempotency-key')
      keys.push(rawHeaders[index + 1] ?? '');
  }
  const key = keys[0];
  if (
    keys.length !== 1 ||
    key === undefined ||
    !/^[\x21-\x7e]{1,128}$/.test(key)
  ) {
    throw new BadRequestException(
      'Exactly one Idempotency-Key of 1–128 printable ASCII characters without spaces is required',
    );
  }
  return key;
}

function canonical(value: unknown): string {
  if (Array.isArray(value))
    return `[${(value as unknown[]).map(canonical).join(',')}]`;
  if (isRecord(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  const encoded = JSON.stringify(value);
  if (encoded === undefined)
    throw new BadRequestException('Body must contain only JSON values');
  return encoded;
}

/** Hashes canonical JSON while preserving array order and original string contents. */
export function fingerprint(body: unknown): Buffer {
  return createHash('sha256').update(canonical(body)).digest();
}

/** Validates each input independently so one bad row never invalidates a batch. */
export function validatePoints(rows: readonly unknown[]): {
  valid: ValidPoint[];
  rejected: Rejection[];
} {
  const valid: ValidPoint[] = [];
  const rejected: Rejection[] = [];
  rows.forEach((row, index) => {
    try {
      if (!isRecord(row)) throw new Error('point must be an object');
      const id = seriesId(row.seriesId);
      const time = timestamp(row.ts);
      valid.push({
        index,
        seriesId: id,
        ts: time.sql,
        micros: time.micros,
        value: decimal(row.value),
      });
    } catch (error: unknown) {
      rejected.push({
        index,
        reason: error instanceof Error ? error.message : 'Invalid point',
      });
    }
  });
  return { valid, rejected };
}

/** Groups valid identities in batch order, then sorts candidates to avoid lock inversion. */
export function groupPoints(
  points: readonly ValidPoint[],
  rejected: Rejection[],
): PointGroup[] {
  const groups = new Map<string, PointGroup>();
  for (const point of points) {
    const identity = `${point.seriesId}:${point.micros}`;
    const existing = groups.get(identity);
    if (!existing) groups.set(identity, { point, indexes: [point.index] });
    else if (existing.point.value === point.value)
      existing.indexes.push(point.index);
    else
      rejected.push({
        index: point.index,
        reason: 'Conflicting value for the same point within the batch',
      });
  }
  return [...groups.values()].sort((a, b) => {
    const difference = BigInt(a.point.seriesId) - BigInt(b.point.seriesId);
    if (difference !== 0n) return difference < 0n ? -1 : 1;
    return a.point.micros < b.point.micros
      ? -1
      : a.point.micros > b.point.micros
        ? 1
        : 0;
  });
}

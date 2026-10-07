import { BadRequestException } from '@nestjs/common';
import { seriesId } from '../validation/numeric';
import { timestamp } from '../validation/timestamp';

/** Validated SQL parameters for a UTC-aligned half-open bucket query. */
export interface BucketQuery {
  id: string;
  from: string;
  to: string;
  unit: 'minute' | 'hour' | 'day';
  interval: string;
}

/** Validates a path ID without relying on SQL casts to report client errors. */
export function queryId(value: unknown): string {
  try {
    return seriesId(value);
  } catch (error: unknown) {
    throw new BadRequestException(
      error instanceof Error ? error.message : 'Invalid series ID',
    );
  }
}

/** Validates query inputs without imposing the declined bucket-count or year caps. */
export function bucketQuery(
  id: unknown,
  from: unknown,
  to: unknown,
  bucket: unknown,
): BucketQuery {
  try {
    const start = timestamp(from);
    const end = timestamp(to);
    if (start.micros >= end.micros)
      throw new Error('from must be earlier than to');
    const sizes: Record<
      string,
      { unit: 'minute' | 'hour' | 'day'; interval: string }
    > = {
      '1m': { unit: 'minute', interval: '1 minute' },
      '1h': { unit: 'hour', interval: '1 hour' },
      '1d': { unit: 'day', interval: '1 day' },
    };
    const size =
      typeof bucket === 'string' && Object.hasOwn(sizes, bucket)
        ? sizes[bucket]
        : undefined;
    if (!size) throw new Error('bucket must be 1m, 1h, or 1d');
    return { id: seriesId(id), from: start.sql, to: end.sql, ...size };
  } catch (error: unknown) {
    throw new BadRequestException(
      error instanceof Error ? error.message : 'Invalid bucket query',
    );
  }
}

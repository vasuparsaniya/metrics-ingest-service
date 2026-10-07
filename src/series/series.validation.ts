import { isRecord } from '../ingest/ingest.validation';

/** Validates names using PostgreSQL-compatible Unicode character counts. */
export function seriesName(body: unknown): string {
  if (!isRecord(body) || typeof body.name !== 'string')
    throw new Error('name must be a string');
  const name = body.name.trim();
  if (
    [...name].length < 1 ||
    [...name].length > 200 ||
    name.includes('\0') ||
    Buffer.from(name).toString('utf8') !== name
  ) {
    throw new Error(
      'name must contain 1–200 Unicode characters and no null character',
    );
  }
  return name;
}

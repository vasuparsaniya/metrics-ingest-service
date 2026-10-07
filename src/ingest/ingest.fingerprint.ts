import { BadRequestException } from '@nestjs/common';
import { createHash, Hash } from 'node:crypto';
import { setImmediate as yieldToIo } from 'node:timers/promises';
import { processingChunkSize } from './ingest.processing';
import { isRecord } from './ingest.validation';

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

async function writeCanonical(hash: Hash, value: unknown): Promise<void> {
  if (Array.isArray(value)) {
    const items = value as unknown[];
    hash.update('[');
    for (let offset = 0; offset < items.length; offset += processingChunkSize) {
      if (offset > 0) hash.update(',');
      hash.update(
        items
          .slice(offset, offset + processingChunkSize)
          .map(canonical)
          .join(','),
      );
      if (offset + processingChunkSize < items.length) await yieldToIo();
    }
    hash.update(']');
  } else if (isRecord(value)) {
    hash.update('{');
    const keys = Object.keys(value).sort();
    for (const [index, key] of keys.entries()) {
      if (index > 0) hash.update(',');
      hash.update(`${JSON.stringify(key)}:`);
      await writeCanonical(hash, value[key]);
    }
    hash.update('}');
  } else hash.update(canonical(value));
}

/** Streams the unchanged canonical JSON bytes, yielding between 250 array elements. */
export async function fingerprint(body: unknown): Promise<Buffer> {
  const hash = createHash('sha256');
  await writeCanonical(hash, body);
  return hash.digest();
}

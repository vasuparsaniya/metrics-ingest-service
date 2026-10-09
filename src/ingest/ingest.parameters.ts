import { PointGroup } from './ingest.types';
import { setImmediate as yieldToIo } from 'node:timers/promises';
import { processingChunkSize } from './ingest.processing';

function quote(value: string): string {
  const escaped =
    value.includes('\\') || value.includes('"')
      ? value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      : value;
  return `"${escaped}"`;
}

/** Encodes aligned string arrays as bound PostgreSQL parameters, never SQL text. */
export async function measurementParameters(
  groups: readonly PointGroup[],
): Promise<[string, string, string]> {
  const parts: [string[], string[], string[]] = [[], [], []];
  for (let offset = 0; offset < groups.length; offset += processingChunkSize) {
    const ids: string[] = [];
    const times: string[] = [];
    const values: string[] = [];
    const end = Math.min(offset + processingChunkSize, groups.length);
    for (let index = offset; index < end; index++) {
      const group = groups[index];
      if (!group) throw new Error('Measurement parameter group is missing');
      ids.push(quote(group.point.seriesId));
      times.push(quote(group.point.ts));
      values.push(quote(group.point.value));
    }
    parts[0].push(ids.join(','));
    parts[1].push(times.join(','));
    parts[2].push(values.join(','));
    if (end < groups.length) await yieldToIo();
  }
  return [
    `{${parts[0].join(',')}}`,
    `{${parts[1].join(',')}}`,
    `{${parts[2].join(',')}}`,
  ];
}

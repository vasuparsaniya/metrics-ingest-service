import { createHash } from 'node:crypto';
import { fingerprint } from './ingest.fingerprint';

function legacyCanonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(legacyCanonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${legacyCanonical(record[key])}`)
      .join(',')}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error('Non-JSON value');
  return encoded;
}

async function expectLegacy(body: unknown): Promise<void> {
  const expected = createHash('sha256').update(legacyCanonical(body)).digest();
  expect(await fingerprint(body)).toEqual(expected);
}

describe('canonical fingerprint compatibility', () => {
  it.each([
    ['seriesId', 'ts', 'value'],
    ['seriesId', 'value', 'ts'],
    ['ts', 'seriesId', 'value'],
    ['ts', 'value', 'seriesId'],
    ['value', 'seriesId', 'ts'],
    ['value', 'ts', 'seriesId'],
  ])('preserves bytes for property order %j', async (...keys) => {
    const fields: Record<string, string> = {
      seriesId: '001',
      ts: '2026-10-08T10:00:00.123456Z',
      value: '-001.2500',
    };
    await expectLegacy({
      points: [Object.fromEntries(keys.map((key) => [key, fields[key]]))],
    });
  });

  it.each(['', '"quoted"', '\\slash', '\n\t\u0000', 'é😀\ud800'])(
    'preserves JSON escaping for %j',
    async (value) => {
      await expectLegacy({ points: [{ value, ts: value, seriesId: value }] });
    },
  );

  it('retains generic semantics for extra/missing fields and non-string values', async () => {
    await expectLegacy({
      extra: { '2': 'two', '10': 'ten', nested: [null, false, -0, 12.5] },
      points: [
        { value: '1', ts: 'a', seriesId: '1', unit: 'C' },
        { value: '1', ts: 'a', other: 'x' },
        { value: null, ts: ['a', 'b'], seriesId: { z: 2, a: 1 } },
        { value: 1, ts: 'a', seriesId: '1' },
        { value: true, ts: 'a', seriesId: '1' },
      ],
    });
  });

  it('keeps extra fields, original spellings and array order significant', async () => {
    const point = { seriesId: '1', ts: 'a', value: '1' };
    const original = await fingerprint({ points: [point] });
    expect(
      await fingerprint({ points: [{ ...point, value: '1.0' }] }),
    ).not.toEqual(original);
    expect(
      await fingerprint({ points: [{ ...point, unit: 'C' }] }),
    ).not.toEqual(original);
    const second = { ...point, value: '2' };
    expect(await fingerprint({ points: [point, second] })).not.toEqual(
      await fingerprint({ points: [second, point] }),
    );
  });

  it('matches legacy bytes for a full standard batch', async () => {
    const body = {
      points: Array.from({ length: 5000 }, (_, index) => ({
        value: String(index),
        ts: '2026-10-08T10:00:00Z',
        seriesId: '1',
      })),
    };
    const expected = createHash('sha256')
      .update(legacyCanonical(body))
      .digest();
    expect(await fingerprint(body)).toEqual(expected);
  });
});

import { decimal, exactCount, seriesId } from './numeric';
import { timestamp } from './timestamp';
import {
  batchBody,
  groupPoints,
  requestKey,
  validatePoints,
} from '../ingest/ingest.validation';
import { fingerprint } from '../ingest/ingest.fingerprint';
import { seriesName } from '../series/series.validation';
import { bucketQuery } from '../queries/query.validation';

describe('exact boundary validation', () => {
  it('preserves decimal precision and compares equivalent spellings', () => {
    expect(decimal('00025.5000')).toBe('25.5');
    expect(decimal('-0.0000')).toBe('0');
    expect(decimal('-12345678901234567890.12345678901234567890')).toBe(
      '-12345678901234567890.1234567890123456789',
    );
    expect(decimal(`0.${'0'.repeat(16382)}1`)).toHaveLength(16385);
  });
  it.each([25, 'NaN', 'Infinity', '1e3', ' 1', '.5', '1.', '1.2.3'])(
    'rejects invalid decimal input %s',
    (value) => {
      expect(() => decimal(value)).toThrow();
    },
  );
  it('rejects only native numeric storage overflow rather than the declined precision caps', () => {
    expect(decimal('1'.repeat(200))).toHaveLength(200);
    expect(() => decimal('1'.repeat(131073))).toThrow('storage bounds');
    expect(() => decimal(`0.${'1'.repeat(16384)}`)).toThrow('storage bounds');
  });
  it('retains microseconds and normalizes equivalent timezone offsets', () => {
    const utc = timestamp('2026-10-07T10:00:00.123456Z');
    expect(timestamp('2026-10-07T15:30:00.123456+05:30')).toEqual(utc);
    expect(timestamp('2026-10-07T10:00:00.123457Z').micros - utc.micros).toBe(
      1n,
    );
    expect(utc.sql).toBe('2026-10-07 10:00:00.123456+00');
  });
  it('supports pre-epoch and expanded-year dates without a JavaScript Date round-trip', () => {
    expect(timestamp('1969-12-31T23:59:59.999999Z').micros).toBe(-1n);
    expect(timestamp('+010000-01-01T00:00:00Z').sql).toBe(
      '10000-01-01 00:00:00.000000+00',
    );
    expect(timestamp('0000-01-01T00:00:00Z').sql).toBe(
      '0001-01-01 00:00:00.000000+00 BC',
    );
  });
  it.each([
    '2026-02-29T00:00:00Z',
    '2026-10-07T24:00:00Z',
    '2026-10-07T00:00:60Z',
    '2026-10-07T00:00:00',
    '2026-10-07T00:00:00.1234567Z',
    '2026-10-07T00:00:00+16:00',
  ])('rejects invalid timestamp %s', (value) => {
    expect(() => timestamp(value)).toThrow();
  });
  it('accepts leap dates without accepting rollover dates', () => {
    expect(timestamp('2024-02-29T00:00:00Z').sql).toContain('2024-02-29');
    expect(() => timestamp('1900-02-29T00:00:00Z')).toThrow();
  });
  it('bounds BIGINT IDs and preserves large count encoding', () => {
    expect(seriesId('009223372036854775807')).toBe('9223372036854775807');
    expect(() => seriesId('9223372036854775808')).toThrow();
    expect(() => seriesId('0')).toThrow();
    expect(exactCount('9007199254740992')).toBe('9007199254740992');
  });
  it('hashes object-property order consistently while preserving string contents and array order', async () => {
    expect(await fingerprint({ points: [{ value: '1', ts: 'a' }] })).toEqual(
      await fingerprint({ points: [{ ts: 'a', value: '1' }] }),
    );
    expect(await fingerprint({ points: ['1', '2'] })).not.toEqual(
      await fingerprint({ points: ['2', '1'] }),
    );
    expect(await fingerprint({ value: '1' })).not.toEqual(
      await fingerprint({ value: '1.0' }),
    );
  });
  it('rejects duplicate keys and enforces the 5000-point maximum', () => {
    expect(requestKey(['Idempotency-Key', 'batch-1'])).toBe('batch-1');
    expect(() =>
      requestKey(['Idempotency-Key', 'a', 'idempotency-key', 'b']),
    ).toThrow();
    expect(() => requestKey(['Idempotency-Key', 'a b'])).toThrow();
    expect(() =>
      batchBody({ points: Array.from({ length: 5001 }, () => null) }),
    ).toThrow();
  });
  it('rejects each bad row separately and groups numerically equal valid points', () => {
    const result = validatePoints([
      { seriesId: '1', ts: '2026-10-07T00:00:00Z', value: '1.00' },
      { seriesId: '1', ts: '2026-10-07T00:00:00Z', value: '1' },
      { seriesId: '1', ts: '2026-10-07T00:00:00Z', value: '2' },
      { seriesId: '1', ts: 'invalid', value: '3' },
    ]);
    const groups = groupPoints(result.valid, result.rejected);
    expect(groups[0]?.indexes).toEqual([0, 1]);
    expect(result.rejected.map((row) => row.index).sort()).toEqual([2, 3]);
  });
  it('counts Unicode characters rather than UTF-16 code units in series names', () => {
    expect(seriesName({ name: ` ${'😀'.repeat(200)} ` })).toHaveLength(400);
    expect(() => seriesName({ name: '\u0000' })).toThrow();
    expect(() => seriesName({ name: '\ud800' })).toThrow();
  });
  it('rejects reversed ranges, repeated query parameters and invalid bucket sizes', () => {
    expect(() =>
      bucketQuery('1', '2026-10-07T00:00:00Z', '2026-10-07T00:00:00Z', '1h'),
    ).toThrow();
    expect(() =>
      bucketQuery('1', ['2026-10-07T00:00:00Z'], '2026-10-08T00:00:00Z', '1h'),
    ).toThrow();
    expect(() =>
      bucketQuery('1', '2026-10-07T00:00:00Z', '2026-10-08T00:00:00Z', '2h'),
    ).toThrow();
  });
});

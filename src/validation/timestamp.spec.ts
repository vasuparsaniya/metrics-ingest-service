import { timestamp } from './timestamp';

describe('UTC timestamp normalization', () => {
  it.each(['', '.1', '.12', '.123', '.1234', '.12345', '.123456'])(
    'matches the general formatter for fractional seconds %s',
    (fraction) => {
      const prefix = `2026-10-08T10:15:30${fraction}`;
      expect(timestamp(`${prefix}Z`)).toEqual(timestamp(`${prefix}+00:00`));
      expect(timestamp(`${prefix}Z`).sql).toBe(
        `2026-10-08 10:15:30.${fraction.slice(1).padEnd(6, '0')}+00`,
      );
    },
  );

  it.each([
    '0001-01-01T00:00:00.000001',
    '1969-12-31T23:59:59.999999',
    '1970-01-01T00:00:00',
    '2000-02-29T23:59:59.123456',
    '9999-12-31T23:59:59.999999',
    '+002026-10-08T10:15:30',
    '+010000-01-01T00:00:00',
    '0000-01-01T00:00:00',
    '-000001-01-01T00:00:00',
    '+294276-12-31T23:59:59.999998',
  ])('preserves calendar and exact microseconds for %s', (prefix) => {
    expect(timestamp(`${prefix}Z`)).toEqual(timestamp(`${prefix}+00:00`));
  });

  it('retains offset conversion across day and year boundaries', () => {
    expect(timestamp('2026-01-01T00:15:30.123456+05:30')).toEqual(
      timestamp('2025-12-31T18:45:30.123456Z'),
    );
    expect(timestamp('2025-12-31T23:30:00.000001-01:00')).toEqual(
      timestamp('2026-01-01T00:30:00.000001Z'),
    );
  });

  it('does not reformat calendar fields for an ordinary UTC input', () => {
    const pad = jest.spyOn(String.prototype, 'padStart');
    let calls: number;
    try {
      timestamp('2026-10-08T10:15:30.123456Z');
      calls = pad.mock.calls.length;
    } finally {
      pad.mockRestore();
    }
    expect(calls).toBe(0);
  });

  it.each([
    '1900-02-29T00:00:00Z',
    '2026-04-31T00:00:00Z',
    '2026-00-01T00:00:00Z',
    '2026-01-00T00:00:00Z',
    '2026-10-08T24:00:00Z',
    '2026-10-08T00:60:00Z',
    '2026-10-08T00:00:60Z',
    '2026-10-08T00:00:00.1234567Z',
    '+294277-01-01T00:00:00Z',
  ])('does not bypass validation for %s', (value) => {
    expect(() => timestamp(value)).toThrow();
  });
});

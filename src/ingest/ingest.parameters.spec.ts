import { setImmediate as yieldToIo } from 'node:timers/promises';
import { measurementParameters } from './ingest.parameters';
import { PointGroup } from './ingest.types';

function groups(length: number): PointGroup[] {
  return Array.from({ length }, (_, index) => ({
    point: {
      index,
      seriesId: '9223372036854775807',
      ts: `2026-10-07 00:00:00.${String(index).padStart(6, '0')}+00`,
      micros: BigInt(index),
      value: '-9007199254740993.123456789',
    },
    indexes: [index],
  }));
}

describe('cooperative measurement parameter encoding', () => {
  it.each([0, 1, 99, 100, 101, 5000])(
    'preserves the driver string-array representation for %i groups',
    async (length) => {
      const input = groups(length);
      const reference = (values: string[]) =>
        `{${values.map((value) => '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"').join(',')}}`;
      expect(await measurementParameters(input)).toEqual([
        reference(input.map((group) => group.point.seriesId)),
        reference(input.map((group) => group.point.ts)),
        reference(input.map((group) => group.point.value)),
      ]);
      expect(input[0]?.point.value ?? '').toBe(
        length ? '-9007199254740993.123456789' : '',
      );
    },
  );

  it('escapes array delimiters, quotes and backslashes without treating NULL as null', async () => {
    const values = ['NULL', '', 'a,b', '{x}', '"quoted"', 'back\\slash', 'é😀'];
    const input = groups(values.length);
    for (const [index, group] of input.entries())
      group.point.value = values[index] ?? '';
    const result = await measurementParameters(input);
    expect(result[2]).toBe(
      '{"NULL","","a,b","{x}","\\"quoted\\"","back\\\\slash","é😀"}',
    );
  });

  it('gives I/O an opportunity before 101-point encoding completes', async () => {
    let ran = false;
    const callback = yieldToIo().then(() => {
      ran = true;
    });
    await measurementParameters(groups(101));
    const ranBeforeCompletion = ran;
    await callback;
    expect(ranBeforeCompletion).toBe(true);
  });
});

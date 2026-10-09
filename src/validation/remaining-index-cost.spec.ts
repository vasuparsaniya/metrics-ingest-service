import {
  indexCostInsert,
  indexCostTable,
  validateIndexCostRows,
} from '../../scripts/load/remaining-index-cost';

describe('remaining index-cost safety', () => {
  it.each(['series', 'ingest_requests', 'bench_other', 'x; DROP TABLE series'])(
    'rejects unrelated table %s',
    (name) => {
      expect(() => indexCostTable(name)).toThrow();
    },
  );
  it.each(['series', 'requests'] as const)(
    'uses equivalent plain inserts for %s',
    (kind) => {
      const prefix = `bench_keycost_0123456789abcdef_${kind}`;
      expect(
        indexCostInsert(`${prefix}_pk`, kind).replace(`${prefix}_pk`, 'table'),
      ).toBe(
        indexCostInsert(`${prefix}_heap`, kind).replace(
          `${prefix}_heap`,
          'table',
        ),
      );
      expect(indexCostInsert(`${prefix}_pk`, kind)).not.toMatch(
        /ON CONFLICT|RETURNING/,
      );
    },
  );
  it.each([0, 7, 2000001, 12.5, NaN])('rejects invalid count %s', (rows) => {
    expect(() => validateIndexCostRows(rows)).toThrow();
  });
  it('accepts approved synthetic count', () =>
    expect(validateIndexCostRows(100000)).toBe(100000));
});

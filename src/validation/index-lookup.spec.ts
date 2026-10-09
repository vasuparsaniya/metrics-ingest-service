import {
  lookupTable,
  lookupSql,
  lookupPairs,
} from '../../scripts/load/index-lookup';

describe('index lookup evidence', () => {
  const fixture = () => {
    const variants = (prefix: string, kind: string, rows: number) => [
      { table: `${prefix}_pk`, kind, rows, primaryKey: true },
      { table: `${prefix}_heap`, kind, rows, primaryKey: false },
    ];
    const primary = variants(
      'bench_pkcost_0123456789abcdef',
      'measurements',
      2000000,
    );
    return {
      primary: {
        kind: 'primary-index-cost',
        withPrimaryKey: primary[0],
        withoutPrimaryKey: primary[1],
      },
      keys: {
        kind: 'remaining-index-cost',
        results: [
          ...variants(
            'bench_keycost_0123456789abcdef_series',
            'series',
            100000,
          ),
          ...variants(
            'bench_keycost_0123456789abcdef_requests',
            'requests',
            100000,
          ),
        ],
      },
    };
  };
  it('accepts all four matching physically owned pairs', () => {
    const data = fixture();
    expect(
      lookupPairs(data.primary, data.keys).map((pair) => pair.kind),
    ).toEqual(['latest', 'range', 'series', 'requests']);
  });
  it('rejects unequal variant row counts', () => {
    const data = fixture();
    if (!data.primary.withoutPrimaryKey) throw new Error('Missing fixture');
    data.primary.withoutPrimaryKey.rows = 10;
    expect(() => lookupPairs(data.primary, data.keys)).toThrow();
  });
  it('rejects incomplete key variants', () => {
    const data = fixture();
    data.keys.results.pop();
    expect(() => lookupPairs(data.primary, data.keys)).toThrow();
  });
  it.each([
    'measurements',
    'series',
    'ingest_requests',
    'bench_fake',
    'x;DROP TABLE series',
  ])('rejects unrelated table %s', (name) =>
    expect(() => lookupTable(name)).toThrow(),
  );
  it('rejects missing reports', () =>
    expect(() => lookupPairs({}, {})).toThrow());
  it('rejects mismatched table kind', () =>
    expect(() =>
      lookupSql('series', 'bench_pkcost_0123456789abcdef_pk'),
    ).toThrow());
  it('produces equivalent latest SQL', () => {
    const prefix = 'bench_pkcost_0123456789abcdef';
    expect(
      lookupSql('latest', `${prefix}_pk`).replace(`${prefix}_pk`, 'table'),
    ).toBe(
      lookupSql('latest', `${prefix}_heap`).replace(`${prefix}_heap`, 'table'),
    );
    expect(lookupSql('latest', `${prefix}_pk`)).toContain(
      'ORDER BY m.ts DESC LIMIT 1',
    );
  });
});

import {
  primaryCostInsert,
  primaryCostTable,
  primaryIndexMarkdown,
  PrimaryIndexRun,
} from '../../scripts/load/primary-index-cost';

const pk = 'bench_pkcost_0123456789abcdef_pk';
const heap = 'bench_pkcost_0123456789abcdef_heap';

describe('isolated measurements index cost', () => {
  it('quotes only the two owned variant identifiers', () => {
    expect(primaryCostTable(pk)).toBe(`"${pk}"`);
    expect(primaryCostTable(heap)).toBe(`"${heap}"`);
  });
  it.each([
    'measurements',
    'series',
    'bench_other_pk',
    'bench_pkcost_0123456789abcdef_pk";DROP TABLE series;',
  ])('rejects unrelated or injected table %s', (name) => {
    expect(() => primaryCostTable(name)).toThrow('Refusing unrelated');
    expect(() => primaryCostInsert(name)).toThrow('Refusing unrelated');
  });
  it('uses identical plain insertion and deterministic ordering for both variants', () => {
    const first = primaryCostInsert(pk);
    expect(first.replace(pk, 'variant')).toBe(
      primaryCostInsert(heap).replace(heap, 'variant'),
    );
    expect(first).toContain('ORDER BY series_id,ts');
    expect(first).toContain(
      'unnest($1::bigint[],$2::timestamptz[],$3::numeric[])',
    );
    expect(first).not.toContain('ON CONFLICT');
    expect(first).not.toContain('RETURNING');
  });
  it('labels kernel measurements separately from HTTP and does not invent full compliance', () => {
    const run: PrimaryIndexRun = {
      table: pk,
      primaryKey: true,
      rows: 40000,
      wallMs: 2000,
      pointsPerSecond: 20000,
      heapBytes: '100',
      indexBytes: '200',
      indexes: [],
      constraints: [],
      reconciliation: [],
    };
    const output = primaryIndexMarkdown({
      withPrimaryKey: run,
      withoutPrimaryKey: {
        ...run,
        table: heap,
        primaryKey: false,
        wallMs: 1000,
        pointsPerSecond: 40000,
        indexBytes: '0',
      },
    });
    expect(output).toContain('not HTTP acceptance');
    expect(output).toContain('50.00%');
    expect(output).toContain('Other required indexes remain unmeasured');
    expect(output).toContain('PK physically removed');
    expect(output).toContain('40000');
    expect(output).not.toContain('2000000');
  });
});

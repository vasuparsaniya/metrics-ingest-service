import {
  generateComparisonReport,
  renderComparisonReport,
} from '../../scripts/load/comparison-report';
import files from 'node:fs/promises';
import { resolve } from 'node:path';

const report = {
  kind: 'comparison',
  runId: 'dataset',
  fullAssignmentScale: true,
  writeStrategies: {
    unnestPrimaryOnly: {
      inserted: 2000000,
      wallMs: 20000,
      pointsPerSecond: 100000,
      accuracy: 'matched',
      table: 'base',
      strategy: 'unnest',
    },
    valuesPrimaryOnly: {
      inserted: 2000000,
      wallMs: 25000,
      pointsPerSecond: 80000,
      accuracy: 'matched',
      table: 'values',
      strategy: 'values',
    },
    unnestWithCoveringIndex: {
      inserted: 2000000,
      wallMs: 25000,
      pointsPerSecond: 80000,
      accuracy: 'matched',
      table: 'cover',
      strategy: 'unnest',
    },
  },
  queryTimings: {
    primaryOnly: { samples: 20, p50Ms: 100, p95Ms: 200 },
    withCoveringIndex: { samples: 20, p50Ms: 80, p95Ms: 150 },
  },
  readPlans: {
    indexesDisabled: { wallMs: 30000, error: 'statement timeout' },
    production: { wallMs: 200, output: 'Index Scan\nExecution Time: 200 ms' },
  },
  sizes: [{ relation: 'cover_idx', bytes: '123456' }],
};

describe('readable SQL comparison report', () => {
  it('preserves the first summary and exclusively creates a unique fallback', async () => {
    const read = jest
      .spyOn(files, 'readFile')
      .mockResolvedValue(JSON.stringify(report));
    const write = jest
      .spyOn(files, 'writeFile')
      .mockRejectedValueOnce(
        Object.assign(new Error('exists'), { code: 'EEXIST' }),
      )
      .mockResolvedValueOnce(undefined);
    try {
      expect(await generateComparisonReport('/tmp/run/comparison-1.json')).toBe(
        resolve('/tmp/run/comparison-1.md'),
      );
      expect(write.mock.calls[0]?.[0]).toBe(resolve('/tmp/run/COMPARISON.md'));
      expect(write.mock.calls[1]?.[2]).toEqual({ flag: 'wx' });
    } finally {
      read.mockRestore();
      write.mockRestore();
    }
  });
  it('reports actual strategies, relative index costs and real plans', () => {
    const md = renderComparisonReport(report, '/tmp/run/comparison-1.json');
    expect(md).toContain('100000.00');
    expect(md).toContain('-20.00%');
    expect(md).toContain('25.00%');
    expect(md).toContain('statement timeout');
    expect(md).toContain('123456');
    expect(md).toContain('Index Scan');
    expect(md).toContain('[Original comparison JSON](comparison-1.json)');
    expect(md).toContain('not HTTP');
    expect(md).toContain('not an end-to-end');
  });
  it('does not turn missing or failed evidence into successes', () => {
    const md = renderComparisonReport(
      { kind: 'comparison', passed: false, error: 'database unavailable' },
      '/tmp/run/failed.json',
    );
    expect(md).toContain('Execution: Fail');
    expect(md).toContain('database unavailable');
    expect(md).toContain('Not measured');
    expect(md).not.toContain('0.00 points/sec');
  });
  it('distinguishes smaller datasets and refuses unrelated report kinds', () => {
    expect(
      renderComparisonReport(
        { ...report, fullAssignmentScale: false },
        '/tmp/run/c.json',
      ),
    ).toContain('not full assignment scale');
    expect(() =>
      renderComparisonReport({ kind: 'acceptance' }, '/tmp/a.json'),
    ).toThrow();
  });
});

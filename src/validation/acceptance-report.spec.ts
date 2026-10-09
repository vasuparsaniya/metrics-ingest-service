import { renderAcceptanceReport } from '../../scripts/load/report';

const path = '/tmp/run/acceptance.json';
const report = {
  kind: 'acceptance',
  runId: 'run',
  passed: true,
  error: null,
  results: {
    A: {
      path: '/tmp/run/data/cold.json',
      report: {
        mode: 'cold',
        settings: { points: 2000000, writers: 8, batchSize: 5000 },
        finalDatabaseRows: '2000000',
        throughputNewPointsPerSecond: 25572.9,
        accuracy: { passed: true },
        aggregateVerification: true,
        memory: { peakBytes: 240349184, errors: [] },
        reads: {
          latest: { success: { p95Ms: 536.37 }, failed: { samples: 0 } },
        },
      },
    },
    F: {
      idle: {
        buckets: { success: { p95Ms: 1337.35 }, failed: { samples: 0 } },
      },
    },
  },
};

describe('readable acceptance report', () => {
  it.each(['replay', 'resume'])(
    'labels actual %s reads without claiming fresh writes',
    (mode) => {
      const md = renderAcceptanceReport(
        {
          ...report,
          results: {
            ...report.results,
            A: { report: { ...report.results.A.report, mode } },
          },
        },
        path,
      );
      expect(md).toContain(`Latest p95 during ${mode}`);
      expect(md).toContain(`Bucket p95 during ${mode}`);
      expect(md).not.toContain('during fresh writes');
      expect(md).toContain('Performance: Not measured');
    },
  );
  it.each([512000000, 520000000])(
    'fails literal MB memory threshold at %s bytes',
    (peakBytes) => {
      const md = renderAcceptanceReport(
        {
          ...report,
          results: {
            ...report.results,
            A: {
              report: {
                ...report.results.A.report,
                memory: { peakBytes, errors: [] },
              },
            },
          },
        },
        path,
      );
      expect(md).toMatch(/API sampled peak RSS.*<512 MB.*Fail/);
    },
  );
  it('does not confuse correctness success with performance compliance', () => {
    const md = renderAcceptanceReport(report, path);
    expect(md).toContain('Performance: Fail');
    expect(md).toContain('536.37 ms | ≤50 ms | Fail');
    expect(md).toContain('1337.35 ms | ≤150 ms | Fail');
    expect(md).toContain('229.21 MiB');
    expect(md).toContain('[A evidence](data/cold.json)');
    expect(md).toContain('Not measured');
    expect(md).toContain('Database: Not recorded');
    expect(md).toContain('POSIX SIGTERM recovery verified: Not measured');
  });
  it('renders partial failures without invented numbers', () => {
    const md = renderAcceptanceReport(
      {
        kind: 'acceptance',
        passed: false,
        error: 'connection failed',
        results: {},
      },
      path,
    );
    expect(md).toContain('Acceptance execution: Fail');
    expect(md).toContain('connection failed');
    expect(md).toContain('Performance: Not measured');
    expect(md).not.toContain('0.00 ms');
  });
  it('does not certify replay or small loads as fresh full-scale evidence', () => {
    const md = renderAcceptanceReport(
      {
        ...report,
        results: {
          ...report.results,
          A: {
            report: {
              ...report.results.A.report,
              mode: 'replay',
              settings: { points: 5000 },
            },
          },
        },
      },
      path,
    );
    expect(md).toContain('Performance: Not measured');
    expect(md).toContain('not a fresh two-million-point load');
  });
  it('rejects unrelated JSON and escapes markdown text', () => {
    expect(() =>
      renderAcceptanceReport({ kind: 'comparison' }, path),
    ).toThrow();
    const md = renderAcceptanceReport(
      { ...report, database: 'a|b\n# heading' },
      path,
    );
    expect(md).not.toContain('a|b\n# heading');
  });
});

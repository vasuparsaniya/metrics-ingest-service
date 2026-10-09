import { indexHttpOptions } from '../../scripts/load/index-http-options';
import { renderIndexHttpReport } from '../../scripts/load/index-http-report';
import { indexHttpIdleReads } from '../../scripts/load/index-http-checks';
import { ApiClient } from '../../scripts/load/http';
import { workload } from '../../scripts/load/workload';
import { expectations } from '../../scripts/load/generator';
import { LoadManifest, RequestMetrics } from '../../scripts/load/types';

const manifest: LoadManifest = {
  version: 1,
  runId: 'test-run',
  createdAt: '',
  total: 8,
  batchSize: 5000,
  writers: 8,
  from: '2026-09-01T00:00:00Z',
  to: '2026-10-01T00:00:00Z',
  seriesIds: ['1', '2', '3', '4', '5', '6', '7', '8'],
  expected: [],
};
manifest.expected = expectations(manifest);

describe('indexed HTTP experiment options and reports', () => {
  it('uses acceptance headings and four-column targets with explicit experimental results', () => {
    const markdown = renderIndexHttpReport({
      kind: 'index-http-benchmark',
      variant: 'indexed',
      passed: true,
      settings: { points: 2000000, samples: 100 },
      finalRows: 2000000,
      writeMeasurementValid: true,
      throughputNewPointsPerSecond: 72000,
      load: {
        reads: { latest: { success: { p95Ms: 85 }, failed: { samples: 0 } } },
      },
      idle: {
        buckets: {
          success: { p95Ms: 185, samples: 100 },
          failed: { samples: 0 },
          attempted: 100,
          requested: 100,
        },
      },
      memory: { peakBytes: 237000000, errors: [] },
      accuracy: { passed: true },
      aggregateVerification: true,
    });
    for (const heading of [
      'Performance targets',
      'Additional measurements',
      'Scenarios A–G',
      'Machine',
      'Errors and pending verification',
      'Evidence',
    ])
      expect(markdown).toContain(`## ${heading}`);
    expect(markdown).toContain('| Checkpoint | Actual | Target | Result |');
    expect(markdown).toContain(
      '| Fresh insertion throughput | 72000.00 points/sec | ≥20,000 points/sec | Pass |',
    );
    expect(markdown).toContain(
      '| Latest p95 during fresh writes | 85.00 ms | ≤50 ms | Fail |',
    );
    expect(markdown).toContain(
      '| 30-day hourly bucket p95, idle | 185.00 ms | ≤150 ms | Fail |',
    );
    expect(markdown).toContain('Experimental target comparison: Fail');
    for (const id of ['B', 'C', 'D', 'E', 'G'])
      expect(markdown).toMatch(
        new RegExp(`\\| ${id} \\|[^\\n]+\\| Not applicable \\|`),
      );
    expect(markdown).toContain('Production compliance: Not applicable');
  });

  it('keeps small-run target comparisons unmeasured and failed read attempts visible', () => {
    const evidence = {
      kind: 'index-http-benchmark',
      variant: 'unindexed',
      settings: { points: 80 },
      finalRows: 80,
      writeMeasurementValid: true,
      throughputNewPointsPerSecond: 80000,
      load: {
        reads: { latest: { success: { p95Ms: 3 }, failed: { samples: 1 } } },
      },
    };
    expect(renderIndexHttpReport(evidence)).toContain(
      '| Fresh insertion throughput | 80000.00 points/sec | ≥20,000 points/sec | Not measured |',
    );
    const full = renderIndexHttpReport({
      ...evidence,
      settings: { points: 2000000 },
      finalRows: 2000000,
    });
    expect(full).toContain(
      '| Latest p95 during fresh writes | 3.00 ms | ≤50 ms | Fail |',
    );
  });
  it('requires explicit variant/database and rejects replay, typo and repeated flags', () => {
    expect(() => indexHttpOptions([])).toThrow('required');
    expect(() => indexHttpOptions(['--variant', 'none'])).toThrow(
      'indexed or unindexed',
    );
    expect(() =>
      indexHttpOptions(['--variant', 'indexed', '--manifest', 'x']),
    ).toThrow('Unknown');
    expect(() =>
      indexHttpOptions(['--variant', 'indexed', '--variant', 'unindexed']),
    ).toThrow('Repeated');
    expect(() => indexHttpOptions(['--database'])).toThrow('Missing');
    expect(indexHttpOptions(['--help']).help).toBe(true);
    expect(
      indexHttpOptions([
        '--variant',
        'unindexed',
        '--database',
        'metrics_index_http_test',
        '--points',
        '8',
        '--samples',
        '20',
      ]),
    ).toMatchObject({ variant: 'unindexed', points: 8, samples: 20 });
  });

  it.each(['indexed', 'unindexed'])(
    'labels %s evidence and never fills missing measurements with zero',
    (variant) => {
      const markdown = renderIndexHttpReport({
        kind: 'index-http-benchmark',
        variant,
        errors: ['timeout'],
        passed: false,
      });
      expect(markdown).toContain(
        variant === 'indexed' ? 'WITH INDEXES' : 'WITHOUT BUSINESS INDEXES',
      );
      expect(markdown).toContain('Not measured');
      expect(markdown).toContain('No completed EXPLAIN');
      expect(markdown).toContain('timeout');
      expect(markdown).toContain('not production compliance');
      expect(markdown).toContain('foreign key');
      expect(markdown).toContain('no replay');
      expect(markdown.split('\n').length).toBeGreaterThan(20);
      expect(markdown).not.toContain('\\n');
    },
  );

  it('rejects unknown report variants', () => {
    expect(() =>
      renderIndexHttpReport({ kind: 'index-http-benchmark', variant: 'auto' }),
    ).toThrow();
  });
});

class EvidenceClient extends ApiClient {
  readonly retries: (number | undefined)[] = [];
  override request(
    _path: string,
    metrics: RequestMetrics,
    _body?: unknown,
    _key?: string,
    retries?: number,
  ): Promise<unknown> {
    this.retries.push(retries);
    metrics.success.push(1);
    metrics.statuses['200'] = (metrics.statuses['200'] ?? 0) + 1;
    return Promise.resolve({ accepted: 8, duplicates: 0, rejected: [] });
  }
}

describe('experimental HTTP retry and failure evidence', () => {
  it('passes zero write retries without changing the ordinary workload default', async () => {
    const experiment = new EvidenceClient('http://localhost', 'token');
    const load = await workload(experiment, manifest, {
      reads: false,
      maxRetries: 0,
    });
    expect(load.returnedAccepted).toBe(8);
    expect(experiment.retries).toEqual([0]);
    const ordinary = new EvidenceClient('http://localhost', 'token');
    await workload(ordinary, manifest, { reads: false });
    expect(ordinary.retries).toEqual([8]);
  });

  it('stops failed idle categories and records attempted versus requested samples', async () => {
    class FailedClient extends ApiClient {
      override request(
        _path: string,
        metrics: RequestMetrics,
        _body?: unknown,
        _key?: string,
        retries?: number,
      ): Promise<unknown> {
        expect(retries).toBe(0);
        metrics.failed.push(5);
        metrics.statuses['429'] = 1;
        return Promise.reject(new Error('query timeout'));
      }
    }
    const result = await indexHttpIdleReads(
      new FailedClient('http://localhost', 'token'),
      manifest,
      100,
    );
    for (const category of [result.latest, result.buckets]) {
      expect(category).toMatchObject({
        requested: 100,
        attempted: 1,
        error: 'query timeout',
        failed: { samples: 1 },
        success: { samples: 0, p95Ms: null },
      });
    }
  });

  it('uses zero as the selected API client retry default on ambiguous writes', async () => {
    const original = global.fetch;
    const fetch = jest
      .fn<ReturnType<typeof global.fetch>, Parameters<typeof global.fetch>>()
      .mockRejectedValue(new Error('lost response'));
    global.fetch = fetch;
    try {
      await expect(
        new ApiClient('http://localhost', 'token', 0).request(
          '/v1/ingest',
          { success: [], failed: [], retries: 0, statuses: {} },
          { points: [] },
          'key',
        ),
      ).rejects.toThrow('lost response');
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      global.fetch = original;
    }
  });
});

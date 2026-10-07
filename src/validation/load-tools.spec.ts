import {
  batchAt,
  expectations,
  pointAt,
  centsText,
  batchKey,
} from '../../scripts/load/generator';
import {
  latency,
  degradation,
  requestMetrics,
} from '../../scripts/load/metrics';
import { ingestResult, ApiClient } from '../../scripts/load/http';
import { LoadManifest } from '../../scripts/load/types';
import { benchmarkUrl } from '../../scripts/load/runtime';
import { options } from '../../scripts/load/options';

const manifest: LoadManifest = {
  version: 1,
  runId: 'test-run',
  createdAt: '2026-10-07T00:00:00Z',
  total: 5001,
  batchSize: 5000,
  writers: 8,
  from: '2026-09-01T00:00:00.000Z',
  to: '2026-10-01T00:00:00.000Z',
  seriesIds: ['1', '2', '3', '4', '5', '6', '7', '8'],
  expected: [],
};

describe('deterministic load tooling', () => {
  it('renders signed exact cents', () => {
    expect(centsText(-1n)).toBe('-0.01');
    expect(centsText(0n)).toBe('0.00');
    expect(centsText(12345678901234567890n)).toBe('123456789012345678.90');
  });
  it('holds only a batch and preserves every identity on replay', () => {
    expect(batchAt(manifest, 0)).toEqual(batchAt(manifest, 0));
    expect(batchAt(manifest, 0)).toHaveLength(5000);
    expect(batchAt(manifest, 1)).toHaveLength(1);
    const points = Array.from({ length: manifest.total }, (_, i) =>
      pointAt(manifest, i),
    );
    expect(new Set(points.map((p) => `${p.seriesId}:${p.ts}`)).size).toBe(
      manifest.total,
    );
    expect(
      points.every((p) => p.ts >= manifest.from && p.ts < manifest.to),
    ).toBe(true);
    expect(batchKey(manifest, 0)).toBe('load:test-run:0');
  });
  it('reconciles independently calculated per-series sums', () => {
    const expected = expectations(manifest);
    expect(expected.reduce((sum, row) => sum + row.count, 0)).toBe(5001);
    for (const row of expected) {
      let sum = 0n;
      for (let i = 0; i < manifest.total; i += 1)
        if (pointAt(manifest, i).seriesId === row.seriesId)
          sum += BigInt((i % 2001) - 1000);
      expect(row.sum).toBe(centsText(sum));
    }
  });
  it('rejects indexes outside the manifest', () => {
    expect(() => pointAt(manifest, -1)).toThrow();
    expect(() => batchAt(manifest, 2)).toThrow();
  });
  it('calculates nearest-rank p95 with empty and unordered samples', () => {
    expect(latency([]).p95Ms).toBeNull();
    expect(latency([9, 1, 3]).p95Ms).toBe(9);
    expect(latency(Array.from({ length: 100 }, (_, i) => i + 1)).p95Ms).toBe(
      95,
    );
  });
  it('narrows outcomes instead of trusting JSON casts', () => {
    expect(
      ingestResult({ accepted: 1, duplicates: 0, rejected: [] }).accepted,
    ).toBe(1);
    expect(() =>
      ingestResult({ accepted: -1, duplicates: 0, rejected: [] }),
    ).toThrow();
    expect(() =>
      ingestResult({ accepted: 1, duplicates: 0, rejected: [{}] }),
    ).toThrow();
  });
  it('uses DATABASE_URL by default and overrides only the database name', () => {
    const source = {
      DATABASE_URL:
        'postgresql://user:password@localhost:5433/metrics?sslmode=disable',
      BENCHMARK_DATABASE_URL: 'postgresql://localhost/obsolete',
    };
    expect(new URL(benchmarkUrl(source)).pathname).toBe('/metrics');
    const selected = new URL(benchmarkUrl(source, 'metrics_benchmark'));
    expect(selected.pathname).toBe('/metrics_benchmark');
    expect(selected.username).toBe('user');
    expect(selected.password).toBe('password');
    expect(selected.port).toBe('5433');
    expect(selected.search).toBe('?sslmode=disable');
    expect(
      benchmarkUrl({ DATABASE_URL: 'postgresql://remote.example/metrics' }),
    ).toContain('remote.example/metrics');
    expect(() => benchmarkUrl({})).toThrow();
    expect(() =>
      benchmarkUrl({ DATABASE_URL: 'https://localhost/metrics' }),
    ).toThrow();
    expect(() => benchmarkUrl(source, 'bad";DROP DATABASE metrics')).toThrow();
  });
  it('rejects misspelled CLI options and invalid limits', () => {
    expect(options([]).points).toBe(2000000);
    expect(options(['--points', '40000']).points).toBe(40000);
    expect(options(['--database', 'metrics_benchmark']).database).toBe(
      'metrics_benchmark',
    );
    for (const name of ['', 'a/b', 'x'.repeat(64), 'bad-name'])
      expect(() => options(['--database', name])).toThrow();
    expect(() => options(['--point', '40000'])).toThrow();
    expect(() => options(['--points', '5000.5'])).toThrow();
    expect(() => options(['--samples', '0'])).toThrow();
  });
  it('records unavailable baseline and measured degradation honestly', () => {
    expect(degradation(null, 10)).toBeNull();
    expect(degradation(0, 10)).toBeNull();
    expect(degradation(10, 15)).toBe(50);
  });
  it('retries 429 with the identical serialized body and key', async () => {
    const mocked = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response('{"message":"busy"}', {
          status: 429,
          headers: { 'Retry-After': '0' },
        }),
      )
      .mockResolvedValueOnce(
        new Response('{"accepted":1,"duplicates":0,"rejected":[]}', {
          status: 200,
        }),
      );
    try {
      const metrics = requestMetrics();
      await new ApiClient('http://localhost:3000', 'test-token').request(
        '/v1/ingest',
        metrics,
        { points: [] },
        'stable-key',
      );
      expect(metrics.retries).toBe(1);
      expect(metrics.failed).toHaveLength(1);
      expect(metrics.success).toHaveLength(1);
      expect(mocked.mock.calls[0]?.[1]?.body).toEqual(
        mocked.mock.calls[1]?.[1]?.body,
      );
      expect(mocked.mock.calls[0]?.[1]?.headers).toEqual(
        mocked.mock.calls[1]?.[1]?.headers,
      );
    } finally {
      mocked.mockRestore();
    }
  });
});

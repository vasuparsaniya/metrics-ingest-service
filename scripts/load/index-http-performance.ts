import { at, number, numeric, text } from './report';
import { RSS_TARGET_BYTES } from './rss';

type Result = 'Pass' | 'Fail' | 'Not measured';

/** Compares experimental full-scale evidence to PDF budgets without certifying the normal API. */
export function indexHttpPerformance(input: unknown): {
  rows: string[];
  overall: Result;
} {
  const fullScale = at(input, 'settings', 'points') === 2000000;
  const count = at(input, 'finalRows');
  const validCount = typeof count === 'string' || typeof count === 'number';
  const complete =
    fullScale &&
    at(input, 'writeMeasurementValid') === true &&
    validCount &&
    String(count) === '2000000';
  const statuses: Result[] = [];
  const rows: string[] = [];
  const add = (
    label: string,
    actual: string,
    target: string,
    result: Result,
  ) => {
    statuses.push(result);
    rows.push(`| ${label} | ${actual} | ${target} | ${result} |`);
  };
  const threshold = (
    value: unknown,
    predicate: (n: number) => boolean,
  ): Result => {
    const actual = number(value);
    return !complete || actual === undefined
      ? 'Not measured'
      : predicate(actual)
        ? 'Pass'
        : 'Fail';
  };
  add(
    'Stored rows',
    text(count),
    'Exactly 2,000,000',
    !fullScale || !validCount
      ? 'Not measured'
      : String(count) === '2000000'
        ? 'Pass'
        : 'Fail',
  );
  const throughput = at(input, 'throughputNewPointsPerSecond');
  add(
    'Fresh insertion throughput',
    numeric(throughput, ' points/sec'),
    '≥20,000 points/sec',
    threshold(throughput, (n) => n >= 20000),
  );
  const latest = at(input, 'load', 'reads', 'latest');
  const buckets = at(input, 'idle', 'buckets');
  const latencyResult = (category: unknown, limit: number): Result => {
    if (!complete) return 'Not measured';
    const failures = number(at(category, 'failed', 'samples'));
    if (failures === undefined) return 'Not measured';
    return failures > 0
      ? 'Fail'
      : threshold(at(category, 'success', 'p95Ms'), (n) => n <= limit);
  };
  add(
    'Latest p95 during fresh writes',
    numeric(at(latest, 'success', 'p95Ms'), ' ms'),
    '≤50 ms',
    latencyResult(latest, 50),
  );
  let bucketResult = latencyResult(buckets, 150);
  const requested = number(at(buckets, 'requested'));
  const successes = number(at(buckets, 'success', 'samples'));
  if (
    number(at(buckets, 'failed', 'samples')) === 0 &&
    (requested === undefined ||
      requested < 20 ||
      successes === undefined ||
      successes < requested ||
      at(buckets, 'attempted') !== requested)
  )
    bucketResult = 'Not measured';
  add(
    '30-day hourly bucket p95, idle',
    numeric(at(buckets, 'success', 'p95Ms'), ' ms'),
    '≤150 ms',
    bucketResult,
  );
  const peak = number(at(input, 'memory', 'peakBytes'));
  const memoryErrors = at(input, 'memory', 'errors');
  add(
    'API sampled peak RSS',
    numeric(peak === undefined ? undefined : peak / 1048576, ' MiB'),
    '<512 MB (512,000,000 bytes)',
    !Array.isArray(memoryErrors) || memoryErrors.length
      ? 'Not measured'
      : threshold(peak, (n) => n < RSS_TARGET_BYTES),
  );
  return {
    rows,
    overall: !fullScale
      ? 'Not measured'
      : statuses.includes('Fail')
        ? 'Fail'
        : statuses.every((status) => status === 'Pass')
          ? 'Pass'
          : 'Not measured',
  };
}

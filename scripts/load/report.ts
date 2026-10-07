import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { isRecord } from '../../src/ingest/ingest.validation';

type Status = 'Pass' | 'Fail' | 'Not measured';

export function at(value: unknown, ...keys: string[]): unknown {
  for (const key of keys) value = isRecord(value) ? value[key] : undefined;
  return value;
}
export function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}
export function text(value: unknown): string {
  if (value === undefined || value === null) return 'Not recorded';
  const rendered =
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
      ? String(value)
      : (JSON.stringify(value) ?? 'Not recorded');
  return rendered.replace(/[\r\n]+/g, ' ').replace(/[\\`*_[\]<>|#]/g, '\\$&');
}
function flag(value: unknown): Status {
  return value === true ? 'Pass' : value === false ? 'Fail' : 'Not measured';
}
export function numeric(value: unknown, suffix: string): string {
  const n = number(value);
  return n === undefined ? 'Not measured' : `${n.toFixed(2)}${suffix}`;
}

/** Formats recorded evidence only; acceptance's correctness flag is not performance compliance. */
export function renderAcceptanceReport(
  input: unknown,
  jsonPath: string,
): string {
  if (
    !isRecord(input) ||
    input.kind !== 'acceptance' ||
    !isRecord(input.results)
  )
    throw new Error('Expected an acceptance report with results');
  const results = input.results;
  const load = at(results, 'A', 'report');
  const replay = at(results, 'B', 'report');
  const fresh =
    at(load, 'mode') === 'cold' && at(load, 'settings', 'points') === 2000000;
  const statuses: Status[] = [];
  const rows: string[] = [];
  const add = (
    label: string,
    actual: string,
    target: string,
    status: Status,
  ) => {
    statuses.push(status);
    rows.push(`| ${label} | ${actual} | ${target} | ${status} |`);
  };
  const threshold = (
    value: unknown,
    predicate: (n: number) => boolean,
    valid = fresh,
  ): Status => {
    const n = number(value);
    return !valid || n === undefined
      ? 'Not measured'
      : predicate(n)
        ? 'Pass'
        : 'Fail';
  };
  const count = at(load, 'finalDatabaseRows');
  add(
    'Stored rows',
    text(count),
    'Exactly 2,000,000',
    !fresh || (typeof count !== 'string' && typeof count !== 'number')
      ? 'Not measured'
      : String(count) === '2000000'
        ? 'Pass'
        : 'Fail',
  );
  const throughput = at(load, 'throughputNewPointsPerSecond');
  add(
    'Fresh insertion throughput',
    numeric(throughput, ' points/sec'),
    '≥20,000 points/sec',
    threshold(throughput, (n) => n >= 20000),
  );
  const latest = at(load, 'reads', 'latest', 'success', 'p95Ms');
  const bucket = at(results, 'F', 'idle', 'buckets', 'success', 'p95Ms');
  const latencyStatus = (
    value: unknown,
    category: unknown,
    limit: number,
  ): Status =>
    fresh && (number(at(category, 'failed', 'samples')) ?? 0) > 0
      ? 'Fail'
      : threshold(value, (n) => n <= limit);
  add(
    'Latest p95 during fresh writes',
    numeric(latest, ' ms'),
    '≤50 ms',
    latencyStatus(latest, at(load, 'reads', 'latest'), 50),
  );
  add(
    '30-day hourly bucket p95, idle',
    numeric(bucket, ' ms'),
    '≤150 ms',
    latencyStatus(bucket, at(results, 'F', 'idle', 'buckets'), 150),
  );
  const peak = number(at(load, 'memory', 'peakBytes'));
  const memoryErrors = at(load, 'memory', 'errors');
  add(
    'API sampled peak RSS',
    numeric(peak === undefined ? undefined : peak / 1048576, ' MiB'),
    '<512 MiB',
    Array.isArray(memoryErrors) && memoryErrors.length
      ? 'Not measured'
      : threshold(peak, (n) => n < 536870912),
  );
  const overall = statuses.includes('Fail')
    ? 'Fail'
    : statuses.every((s) => s === 'Pass')
      ? 'Pass'
      : 'Not measured';
  const scenarios: [string, string, Status][] = [
    [
      'A',
      'Exact counts/sums and bucket aggregates',
      at(load, 'accuracy', 'passed') === false ||
      at(load, 'aggregateVerification') === false
        ? 'Fail'
        : at(load, 'accuracy', 'passed') === true &&
            at(load, 'aggregateVerification') === true
          ? 'Pass'
          : 'Not measured',
    ],
    [
      'B',
      'Replay leaves counts and aggregates unchanged',
      flag(at(replay, 'replayAggregatesUnchanged')),
    ],
    [
      'C',
      'Concurrent request/point deduplication',
      flag(at(results, 'C', 'passed')),
    ],
    [
      'D',
      'Partial success and indexed rejection accounting',
      flag(at(results, 'D', 'passed')),
    ],
    [
      'E',
      'Late data changes buckets, not newest timestamp',
      flag(at(results, 'E', 'passed')),
    ],
    [
      'F',
      'Read latency measurements collected',
      number(bucket) !== undefined && number(latest) !== undefined
        ? 'Pass'
        : 'Not measured',
    ],
    [
      'G',
      'Restart, rollback, resume and unchanged replay',
      flag(at(results, 'G', 'passed')),
    ],
  ];
  const link = (label: string, path: unknown): string | undefined => {
    if (typeof path !== 'string') return undefined;
    const target = relative(dirname(resolve(jsonPath)), resolve(path))
      .split('\\')
      .join('/');
    return `- [${label}](${target
      .split('/')
      .map((part) => encodeURIComponent(part))
      .join('/')})`;
  };
  const evidence = [
    link('Acceptance JSON', jsonPath),
    link('A evidence', at(results, 'A', 'path')),
    link('B evidence', at(results, 'B', 'path')),
    link('Restart resume', at(results, 'G', 'resumedReport')),
    link(
      'Restart interruption and lock evidence',
      at(results, 'G', 'interruptedReport'),
    ),
    link('Restart replay', at(results, 'G', 'replayReport')),
    link('Restart failure diagnostics', at(results, 'G', 'failureReport')),
  ].filter(Boolean);
  const machine = at(load, 'machine');
  return [
    '# Acceptance report',
    '',
    `Acceptance execution: ${flag(input.passed)}. Performance: ${fresh ? overall : 'Not measured'}.`,
    '',
    'The execution flag covers completed correctness checks, not all performance targets. This is an acceptance summary, not certification of every assignment deliverable.',
    '',
    `Run: ${text(input.runId)}. Measured at (UTC): ${text(input.measuredAt)}.`,
    `Database: ${text(input.database)}.`,
    `Points: ${text(at(load, 'settings', 'points'))}; batch size: ${text(at(load, 'settings', 'batchSize'))}; writers: ${text(at(load, 'settings', 'writers'))}; mode: ${text(at(load, 'mode'))}.`,
    '',
    ...(fresh
      ? []
      : [
          'This run is not a fresh two-million-point load; its measurements do not establish full-scale performance compliance.',
          '',
        ]),
    '## Performance targets',
    '',
    '| Checkpoint | Actual | Target | Result |',
    '|---|---:|---|---|',
    ...rows,
    '',
    '## Additional measurements',
    '',
    `- Write duration: ${numeric(number(at(load, 'wallMs')) === undefined ? undefined : Number(at(load, 'wallMs')) / 1000, ' seconds')}.`,
    `- Bucket p95 during fresh writes: ${numeric(at(load, 'reads', 'buckets', 'success', 'p95Ms'), ' ms')}.`,
    `- Latest p95, idle: ${numeric(at(results, 'F', 'idle', 'latest', 'success', 'p95Ms'), ' ms')}.`,
    `- p95 degradation, latest / buckets: ${numeric(at(results, 'F', 'p95DegradationPercent', 'latest'), '%')} / ${numeric(at(results, 'F', 'p95DegradationPercent', 'buckets'), '%')}.`,
    `- Replay newly stored rows: ${text(at(replay, 'newlyStoredRows'))}; processed input: ${numeric(at(replay, 'processedInputPointsPerSecond'), ' points/sec')}. Cached accepted responses are not new inserts.`,
    '',
    '## Scenarios A–G',
    '',
    '| Scenario | Check | Correctness/evidence |',
    '|---|---|---|',
    ...scenarios.map(
      ([id, label, status]) => `| ${id} | ${label} | ${status} |`,
    ),
    '',
    `Restart semantics: ${text(at(input, 'termination', 'mode'))}; POSIX SIGTERM recovery verified: ${at(results, 'G', 'passed') === true ? flag(at(input, 'termination', 'posixSigtermScenario')) : 'Not measured'}.`,
    '',
    '## Machine',
    '',
    ...[
      'cpu',
      'logicalCpus',
      'ramBytes',
      'os',
      'node',
      'postgres',
      'postgresJit',
      'postgresInDocker',
      'poolMax',
    ].map((key) => `- ${key}: ${text(at(machine, key))}.`),
    '',
    '## Errors and pending verification',
    '',
    `Acceptance error: ${input.error === null ? 'None' : text(input.error)}.`,
    `Load errors: ${text(at(load, 'errors') === undefined ? undefined : JSON.stringify(at(load, 'errors')))}.`,
    '',
    '- Strategy comparison, index write costs, SQL plans and demonstrated query improvement: Not measured by acceptance; run compare separately.',
    '- Unit/API integration suites and clean-clone reproducibility: Not measured by this report; verify separately.',
    '- Failed performance targets require investigation and a new measurement after optimization. Do not treat replay throughput as fresh insertion throughput.',
    '',
    '## Evidence',
    '',
    ...evidence,
    '',
    'JSON files are the original evidence. This summary is generated after measurement; no database access is needed.',
    '',
  ].join('\n');
}

/** Creates a report without replacing an existing summary or changing the JSON evidence. */
export async function generateAcceptanceReport(
  jsonPath: string,
): Promise<string> {
  const input: unknown = JSON.parse(await readFile(jsonPath, 'utf8'));
  const output = resolve(dirname(jsonPath), 'REPORT.md');
  const markdown = renderAcceptanceReport(input, jsonPath);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, markdown, { flag: 'wx' });
  return output;
}

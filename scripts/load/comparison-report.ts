import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { isRecord } from '../../src/ingest/ingest.validation';
import { at, number, numeric, text } from './report';

function change(before: unknown, after: unknown): string {
  const base = number(before);
  const next = number(after);
  return base === undefined || base <= 0 || next === undefined
    ? 'Not measured'
    : numeric(((next - base) / base) * 100, '%');
}

function entries(value: unknown): [string, unknown][] {
  return isRecord(value) ? Object.entries(value) : [];
}

/** SQL-only evidence is deliberately not labelled as HTTP target compliance. */
export function renderComparisonReport(
  input: unknown,
  jsonPath: string,
): string {
  if (!isRecord(input) || input.kind !== 'comparison')
    throw new Error('Expected a comparison report');
  const writes = entries(input.writeStrategies);
  const failed = input.passed === false || typeof input.error === 'string';
  const execution = failed
    ? 'Fail'
    : writes.length === 3
      ? 'Completed'
      : 'Not measured';
  const base = at(input, 'writeStrategies', 'unnestPrimaryOnly');
  const cover = at(input, 'writeStrategies', 'unnestWithCoveringIndex');
  const query = entries(input.queryTimings);
  const plans = [...entries(input.readPlans), ...entries(input.lookupPlans)];
  const planSections = plans.flatMap(([label, value]) => {
    const output = at(value, 'output');
    const error = at(value, 'error');
    // Indented code preserves arbitrary plan text without closing a Markdown fence.
    return [
      `### ${text(label)}`,
      '',
      `Measured EXPLAIN wall time: ${numeric(at(value, 'wallMs'), ' ms')}.`,
      '',
      ...(typeof error === 'string'
        ? [
            `Failure: ${text(error)}. No successful execution plan is claimed.`,
            '',
            `Note: ${text(at(value, 'note'))}.`,
            '',
          ]
        : []),
      ...(typeof output === 'string'
        ? output.split(/\r?\n/).map((line) => `    ${line}`)
        : ['Plan output: Not measured.']),
      '',
    ];
  });
  const sizes = Array.isArray(input.sizes) ? input.sizes : [];
  const jsonName = encodeURIComponent(basename(jsonPath));
  return [
    '# SQL strategy and index comparison',
    '',
    `Execution: ${execution}. Full assignment scale: ${input.fullAssignmentScale === true ? 'Yes' : input.fullAssignmentScale === false ? 'No — not full assignment scale' : 'Not recorded'}.`,
    '',
    `Dataset run: ${text(input.runId)}. Measured at (UTC): ${text(input.measuredAt)}.`,
    `Database: ${text(input.database)}.`,
    `Points: ${text(at(input, 'settings', 'points') ?? at(base, 'inserted'))}; batch size: ${text(at(input, 'settings', 'batchSize'))}; writers: ${text(at(input, 'settings', 'writers'))}; comparison pool: ${text(input.comparisonPoolMax)}.`,
    '',
    '## Insert strategies and reconciliation',
    '',
    '| Experiment | Rows | Duration | Throughput | Exact reconciliation |',
    '|---|---:|---:|---:|---|',
    ...(writes.length
      ? writes.map(
          ([label, value]) =>
            `| ${text(label)} | ${text(at(value, 'inserted'))} | ${numeric(number(at(value, 'wallMs')) === undefined ? undefined : Number(at(value, 'wallMs')) / 1000, ' s')} | ${numeric(at(value, 'pointsPerSecond'), ' points/sec')} | ${text(at(value, 'accuracy'))} |`,
        )
      : [
          '| Not measured | Not measured | Not measured | Not measured | Not measured |',
        ]),
    '',
    'These are insert-kernel microbenchmarks, not an end-to-end API throughput claim. They exclude HTTP validation, request hashing, idempotency records and post-insert classification.',
    '',
    '## Optional covering-index cost',
    '',
    `- Throughput change versus primary-only UNNEST: ${change(at(base, 'pointsPerSecond'), at(cover, 'pointsPerSecond'))}. Negative means slower writes.`,
    `- Write-duration change for the same dataset: ${change(at(base, 'wallMs'), at(cover, 'wallMs'))}. Positive means longer writes.`,
    `- Bucket SQL p95 change: ${change(at(input, 'queryTimings', 'primaryOnly', 'p95Ms'), at(input, 'queryTimings', 'withCoveringIndex', 'p95Ms'))}. Negative means faster reads.`,
    '',
    '## SQL query timings',
    '',
    '| Experiment | Samples | Minimum | p50 | p95 | Maximum |',
    '|---|---:|---:|---:|---:|---:|',
    ...(query.length
      ? query.map(
          ([label, value]) =>
            `| ${text(label)} | ${text(at(value, 'samples'))} | ${numeric(at(value, 'minMs'), ' ms')} | ${numeric(at(value, 'p50Ms'), ' ms')} | ${numeric(at(value, 'p95Ms'), ' ms')} | ${numeric(at(value, 'maxMs'), ' ms')} |`,
        )
      : [
          '| Not measured | Not measured | Not measured | Not measured | Not measured | Not measured |',
        ]),
    '',
    'These are direct SQL timings, not HTTP latency results. They do not prove the ≤150 ms bucket or ≤50 ms latest API targets, nor latest latency under concurrent API writes.',
    '',
    '## Relation storage',
    '',
    '| Relation | Recorded bytes | MiB |',
    '|---|---:|---:|',
    ...(sizes.length
      ? sizes.map((value) => {
          const bytes = at(value, 'bytes');
          const parsed =
            typeof bytes === 'string' && /^\d+$/.test(bytes)
              ? Number(bytes)
              : number(bytes);
          return `| ${text(at(value, 'relation'))} | ${text(bytes)} | ${numeric(parsed === undefined ? undefined : parsed / 1048576, ' MiB')} |`;
        })
      : ['| Not measured | Not measured | Not measured |']),
    '',
    'Sizes are pg_relation_size values for the listed heap/index relations, not total database usage (TOAST/WAL and unlisted relations are not included).',
    '',
    '## EXPLAIN (ANALYZE, BUFFERS) evidence',
    '',
    ...(plans.length ? planSections : ['Not measured.', '']),
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
    ].map((key) => `- ${key}: ${text(at(input, 'machine', key))}.`),
    '',
    '## Methodology, limitations and conclusions',
    '',
    `Methodology: ${text(input.methodology)}.`,
    '',
    `Index experiment: ${text(input.indexExperiment)}.`,
    '',
    `Error: ${input.error === undefined || input.error === null ? 'None recorded' : text(input.error)}.`,
    '',
    'Sequential trials are sensitive to cache/order noise. A timed-out index-disabled query is failed evidence, not a fabricated plan. Primary-key constraints stay intact; no production index was changed. This comparison alone does not justify adopting an index or certify a production improvement. Review the write/read trade-off and rerun API benchmarks after any adopted change.',
    '',
    'Retained experimental tables:',
    '',
    ...(Array.isArray(input.retainedTables)
      ? input.retainedTables.map((value) => `- ${text(value)}.`)
      : ['- Not recorded.']),
    '',
    '## Original evidence',
    '',
    `- [Original comparison JSON](${jsonName})`,
    '',
    'Generated after measurements, without accessing the database. Missing evidence remains Not measured.',
    '',
  ].join('\n');
}

/** Preserve the first summary and use a per-JSON name for subsequent comparisons. */
export async function generateComparisonReport(
  jsonPath: string,
): Promise<string> {
  const input: unknown = JSON.parse(await readFile(jsonPath, 'utf8'));
  const markdown = renderComparisonReport(input, jsonPath);
  const first = resolve(dirname(jsonPath), 'COMPARISON.md');
  try {
    await writeFile(first, markdown, { flag: 'wx' });
    return first;
  } catch (error: unknown) {
    if (!isRecord(error) || error.code !== 'EEXIST') throw error;
  }
  const next = resolve(dirname(jsonPath), `${basename(jsonPath, '.json')}.md`);
  await writeFile(next, markdown, { flag: 'wx' });
  return next;
}

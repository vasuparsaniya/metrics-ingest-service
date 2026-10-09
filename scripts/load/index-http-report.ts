import { at, number, numeric, text } from './report';
import { isRecord } from '../../src/ingest/ingest.validation';
import { indexHttpPerformance } from './index-http-performance';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

/** Keeps the physical-index experiment visibly separate from production acceptance. */
export function renderIndexHttpReport(input: unknown): string {
  if (
    !isRecord(input) ||
    input.kind !== 'index-http-benchmark' ||
    (input.variant !== 'indexed' && input.variant !== 'unindexed')
  )
    throw new Error('Invalid indexed HTTP benchmark report');
  const label =
    input.variant === 'indexed' ? 'WITH INDEXES' : 'WITHOUT BUSINESS INDEXES';
  const status = (value: unknown): string =>
    value === true ? 'Pass' : value === false ? 'Fail' : 'Not measured';
  const performance = indexHttpPerformance(input);
  const accuracy = at(input, 'accuracy', 'passed');
  const aggregates = input.aggregateVerification;
  const scenarioA =
    accuracy === false || aggregates === false
      ? 'Fail'
      : accuracy === true && aggregates === true
        ? 'Pass'
        : 'Not measured';
  const latest = at(input, 'load', 'reads', 'latest', 'success', 'p95Ms');
  const bucket = at(input, 'idle', 'buckets', 'success', 'p95Ms');
  const scenarioF =
    (number(at(input, 'load', 'reads', 'latest', 'failed', 'samples')) ?? 0) >
      0 || (number(at(input, 'idle', 'buckets', 'failed', 'samples')) ?? 0) > 0
      ? 'Fail'
      : number(latest) !== undefined && number(bucket) !== undefined
        ? 'Pass'
        : 'Not measured';
  const lines = [
    `# HTTP index experiment — ${label}`,
    '',
    `- Database: ${text(input.database)}`,
    `- Run: ${text(input.runId)}; recorded: ${text(input.measuredAt)}`,
    `- Evidence checks: ${status(input.passed)} (not production compliance)`,
    '',
    `Experimental target comparison: ${performance.overall}. Production compliance: Not applicable.`,
    '',
    '- API mode: Experimental plain inserts; not the normal idempotent ingestion path.',
    `- Points: ${text(at(input, 'settings', 'points'))}; batch: 5000; writers: 8`,
    `- Idle samples requested per category: ${text(at(input, 'settings', 'samples'))}`,
    '',
    '## Performance targets',
    '',
    '| Checkpoint | Actual | Target | Result |',
    '|---|---:|---|---|',
    ...performance.rows,
    '',
    'The PDF budgets are comparison references for this experiment, not production API compliance. Small or incomplete loads cannot establish full-scale performance.',
    '',
    '## Additional measurements',
    '',
    '| Measurement | Recorded result |',
    '|---|---:|',
    `| Complete, reconciled write measurement | ${status(input.writeMeasurementValid)} |`,
    `| Writer duration | ${numeric(at(input, 'load', 'wallMs'), ' ms')} |`,
    `| Ingest successful p95 | ${numeric(at(input, 'load', 'ingest', 'success', 'p95Ms'), ' ms')} |`,
    `| Ingest failed requests | ${text(at(input, 'load', 'ingest', 'failed', 'samples'))} |`,
    `| Bucket p95 during writes | ${numeric(at(input, 'load', 'reads', 'buckets', 'success', 'p95Ms'), ' ms')} |`,
    `| Exact count/sum reconciliation | ${status(at(input, 'accuracy', 'passed'))} |`,
    `| All hourly aggregate values | ${status(input.aggregateVerification)} |`,
    `| Existing route correctness | ${status(at(input, 'routes', 'passed'))} |`,
    `| Bucket EXPLAIN completed | ${status(at(input, 'bucketPlan', 'passed'))} |`,
    '',
    '## Idle HTTP reads',
    '',
    '| Category | Successful samples | Failed samples | Successful p95 | Attempted / requested |',
    '|---|---:|---:|---:|---:|',
  ];
  for (const category of ['latest', 'buckets']) {
    lines.push(
      `| ${category} | ${text(at(input, 'idle', category, 'success', 'samples'))} | ${text(at(input, 'idle', category, 'failed', 'samples'))} | ${numeric(at(input, 'idle', category, 'success', 'p95Ms'), ' ms')} | ${text(at(input, 'idle', category, 'attempted'))} / ${text(at(input, 'idle', category, 'requested'))} |`,
    );
  }
  lines.push(
    '',
    'Idle sampling stops that category after its first failure; skipped samples are not successes.',
    '',
    '## Scenarios A–G',
    '',
    '| Scenario | Check | Correctness/evidence |',
    '|---|---|---|',
    `| A | Exact counts/sums and bucket aggregates | ${scenarioA} |`,
    '| B | Replay leaves counts and aggregates unchanged | Not applicable |',
    '| C | Concurrent request/point deduplication | Not applicable |',
    '| D | Partial success and indexed rejection accounting | Not applicable |',
    '| E | Late data changes buckets, not newest timestamp | Not applicable |',
    `| F | Read latency measurements collected | ${scenarioF} |`,
    '| G | Restart, rollback, resume and unchanged replay | Not applicable |',
    '',
    '## Method and limitations',
    '',
    'Both variants use the identical benchmark-only plain INSERT HTTP path, validation, hashing, grouping, encoding and transactions. Writes are never retried. Unique generated points/keys only; no replay, resume, duplicate/concurrency guarantee or A–G certification. The production API is unchanged.',
    '',
    'Both omit the measurement foreign key so dropping the series primary key is possible without CASCADE. The indexed variant retains all three business primary keys; the unindexed variant physically drops them. The migration tracker index is excluded. This is a combined-index experiment, not an individual-index causal estimate or an exact production baseline.',
    '',
    'Run variants sequentially with identical settings and no other heavy work. Cache, checkpoints and run order affect results. Missing measurements and timed-out plans are not fabricated. Compare throughput only when the complete, reconciled write measurement passes; read/plan failures remain independent failures and do not erase successfully measured writes.',
    '',
    '## Machine',
    '',
    '```json',
    JSON.stringify(input.machine ?? null, null, 2),
    '```',
    '',
    '## Actual schema before / after measurement',
    '',
    '```json',
    JSON.stringify(
      { before: input.schemaBefore ?? null, after: input.schemaAfter ?? null },
      null,
      2,
    ),
    '```',
    '',
    '## Bucket EXPLAIN (ANALYZE, BUFFERS)',
    '',
    `Status: ${status(at(input, 'bucketPlan', 'passed'))}; wall time: ${numeric(at(input, 'bucketPlan', 'wallMs'), ' ms')}`,
    '',
    '```text',
    typeof at(input, 'bucketPlan', 'output') === 'string'
      ? String(at(input, 'bucketPlan', 'output'))
      : 'No completed EXPLAIN output recorded.',
    '```',
    '',
    '## Errors and pending verification',
    '',
    '```json',
    JSON.stringify(input.errors ?? [], null, 2),
    '```',
    '',
    '- Normal API acceptance, replay/concurrency/rejection/restart correctness: Not applicable to this benchmark; run acceptance separately.',
    '- Opposite index variant and per-index costs are independent measurements; this single report does not invent a paired comparison.',
    '- Storage and clean-clone verification are not established by this report.',
    '',
    '## Evidence',
    '',
    '[Complete JSON, statuses, reconciliation and partial evidence](report.json)',
    '',
  );
  lines.push(
    '## Read-only correctness verification attempts',
    '',
    'These requests are outside latency timing. At most one retry is allowed for a transport failure, never an HTTP error. Failed and recovered attempts remain visible; writes and latency samples still use zero retries.',
    '',
    '```json',
    JSON.stringify(input.verificationReads ?? null, null, 2),
    '```',
    '',
  );
  return lines.join('\n');
}

/** Regenerates readable evidence without database access or overwriting historical summaries. */
export async function generateIndexHttpReport(
  jsonPath: string,
  regenerated = false,
): Promise<string> {
  const input: unknown = JSON.parse(await readFile(jsonPath, 'utf8'));
  const path = resolve(
    dirname(jsonPath),
    regenerated ? `REPORT-regenerated-${randomUUID()}.md` : 'REPORT.md',
  );
  const markdown = renderIndexHttpReport(input);
  await writeFile(
    path,
    regenerated
      ? `${markdown}\nRegenerated from original report.json; no measurements rerun or JSON changed.\n`
      : markdown,
    { flag: 'wx' },
  );
  return path;
}

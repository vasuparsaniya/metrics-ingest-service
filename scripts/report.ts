import { generateAcceptanceReport } from './load/report';
import { generateComparisonReport } from './load/comparison-report';
import { readFile } from 'node:fs/promises';
import { isRecord } from '../src/ingest/ingest.validation';
import { generateIndexHttpReport } from './load/index-http-report';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--input' || !args[1])
    throw new Error(
      'Usage: npm run report -- --input <acceptance.json, comparison-*.json or index-http-*/report.json>',
    );
  const input: unknown = JSON.parse(await readFile(args[1], 'utf8'));
  if (
    !isRecord(input) ||
    (input.kind !== 'acceptance' &&
      input.kind !== 'comparison' &&
      input.kind !== 'index-http-benchmark')
  )
    throw new Error(
      'Expected an acceptance, comparison or index HTTP JSON report',
    );
  const path =
    input.kind === 'index-http-benchmark'
      ? await generateIndexHttpReport(args[1], true)
      : input.kind === 'comparison'
        ? await generateComparisonReport(args[1])
        : await generateAcceptanceReport(args[1]);
  console.log(JSON.stringify({ event: 'readable_report', path }));
}
void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

import { generateAcceptanceReport } from './load/report';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--input' || !args[1])
    throw new Error(
      'Usage: npm run report -- --input artifacts/acceptance-<run>/acceptance.json',
    );
  const path = await generateAcceptanceReport(args[1]);
  console.log(JSON.stringify({ event: 'readable_report', path }));
}
void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

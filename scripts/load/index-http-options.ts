import { IndexHttpVariant } from '../../src/benchmark/index-http-schema';
import { options, Options } from './options';

/** Explicit experiment selection, never inferred from an existing database's name. */
export interface IndexHttpOptions extends Options {
  variant?: IndexHttpVariant;
}

/** Requires a variant and fresh database while rejecting unrelated load/replay flags. */
export function indexHttpOptions(
  args = process.argv.slice(2),
): IndexHttpOptions {
  const ordinary: string[] = [];
  const seen = new Set<string>();
  let variant: IndexHttpVariant | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg) throw new Error('Empty option');
    if (seen.has(arg)) throw new Error(`Repeated option ${arg}`);
    seen.add(arg);
    if (arg === '--help') {
      ordinary.push(arg);
      continue;
    }
    if (
      ![
        '--variant',
        '--database',
        '--points',
        '--samples',
        '--report-dir',
      ].includes(arg)
    )
      throw new Error(`Unknown index benchmark option ${arg}`);
    const value = args[++index];
    if (!value || value.startsWith('--'))
      throw new Error(`Missing value for ${arg}`);
    if (arg === '--variant') {
      if (value !== 'indexed' && value !== 'unindexed')
        throw new Error('--variant must be indexed or unindexed');
      variant = value;
    } else ordinary.push(arg, value);
  }
  const parsed = options(ordinary);
  if (!parsed.help && (!variant || !parsed.database))
    throw new Error('--variant and --database are required');
  return { ...parsed, variant };
}

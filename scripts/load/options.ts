/** Parsed arguments shared by the runnable load and acceptance commands. */
export interface Options {
  points: number;
  manifest?: string;
  database?: string;
  reportDir: string;
  samples: number;
  help: boolean;
  profileApi: boolean;
}

/** Rejects misspelled options so a small verification cannot accidentally become a full load. */
export function options(
  args = process.argv.slice(2),
  allowProfile = false,
): Options {
  const result: Options = {
    points: 2000000,
    reportDir: 'artifacts',
    samples: 100,
    help: false,
    profileApi: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--profile-api') {
      if (!allowProfile)
        throw new Error('--profile-api is supported only by npm run load');
      result.profileApi = true;
      continue;
    }
    if (argument === '--help') {
      result.help = true;
      continue;
    }
    const value = args[++index];
    if (!value || value.startsWith('--'))
      throw new Error(`Missing value for ${argument}`);
    if (argument === '--points') result.points = Number(value);
    else if (argument === '--manifest') result.manifest = value;
    else if (argument === '--database') result.database = value;
    else if (argument === '--report-dir') result.reportDir = value;
    else if (argument === '--samples') result.samples = Number(value);
    else throw new Error(`Unknown option ${argument}`);
  }
  if (
    result.database !== undefined &&
    !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(result.database)
  )
    throw new Error(
      '--database must be an ASCII database name of 1–63 characters',
    );
  if (
    !Number.isSafeInteger(result.points) ||
    result.points < 8 ||
    result.points > 2000000
  )
    throw new Error('--points must be between 8 and 2000000');
  if (
    !Number.isSafeInteger(result.samples) ||
    result.samples < 20 ||
    result.samples > 10000
  )
    throw new Error('--samples must be between 20 and 10000');
  return result;
}

/** A timestamp normalized without losing PostgreSQL microsecond precision. */
export interface Timestamp {
  micros: bigint;
  sql: string;
}

const dayMicros = 86400000000n;

function daysFromCivil(year: number, month: number, day: number): number {
  const adjusted = year - (month <= 2 ? 1 : 0);
  const era = Math.floor(adjusted / 400);
  const yearOfEra = adjusted - era * 400;
  const dayOfYear =
    Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  return (
    era * 146097 +
    yearOfEra * 365 +
    Math.floor(yearOfEra / 4) -
    Math.floor(yearOfEra / 100) +
    dayOfYear -
    719468
  );
}

function civilFromDays(days: number): [number, number, number] {
  const shifted = days + 719468;
  const era = Math.floor(shifted / 146097);
  const dayOfEra = shifted - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36524) -
      Math.floor(dayOfEra / 146096)) /
      365,
  );
  const year = yearOfEra + era * 400;
  const dayOfYear =
    dayOfEra -
    (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthIndex = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthIndex + 2) / 5) + 1;
  const month = monthIndex + (monthIndex < 10 ? 3 : -9);
  return [year + (month <= 2 ? 1 : 0), month, day];
}

function sqlTimestamp(micros: bigint): string {
  const days =
    micros >= 0n ? micros / dayMicros : (micros - dayMicros + 1n) / dayMicros;
  let remainder = micros - days * dayMicros;
  const [year, month, day] = civilFromDays(Number(days));
  const hour = remainder / 3600000000n;
  remainder %= 3600000000n;
  const minute = remainder / 60000000n;
  remainder %= 60000000n;
  const second = remainder / 1000000n;
  const fraction = remainder % 1000000n;
  const pad = (part: number | bigint, length = 2): string =>
    String(part).padStart(length, '0');
  return `${pad(year <= 0 ? 1 - year : year, 4)}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}:${pad(second)}.${pad(fraction, 6)}+00${year <= 0 ? ' BC' : ''}`;
}

/** Validates calendar dates and timezone offsets, retaining microseconds and native bounds. */
export function timestamp(value: unknown): Timestamp {
  if (typeof value !== 'string')
    throw new Error('timestamp must be an ISO 8601 string with a timezone');
  const match =
    /^([+-]?\d{4,6})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!match)
    throw new Error(
      'timestamp requires an explicit timezone and at most six fractional digits',
    );
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const zone = match[8] ?? '';
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > (lengths[month - 1] ?? 0) ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    throw new Error('timestamp contains an invalid calendar date or time');
  }
  const zoneHour = zone === 'Z' ? 0 : Number(zone.slice(1, 3));
  const zoneMinute = zone === 'Z' ? 0 : Number(zone.slice(4, 6));
  if (zoneHour > 15 || zoneMinute > 59)
    throw new Error('timestamp timezone offset is outside PostgreSQL bounds');
  const offset = (zoneHour * 60 + zoneMinute) * (zone.startsWith('-') ? -1 : 1);
  const micros =
    BigInt(daysFromCivil(year, month, day)) * dayMicros +
    BigInt(hour * 3600 + minute * 60 + second - offset * 60) * 1000000n +
    BigInt((match[7] ?? '').padEnd(6, '0'));
  // These are PostgreSQL's Julian-day boundaries expressed relative to the Unix epoch.
  if (micros < -210866803200000000n || micros >= 9224318016000000000n) {
    throw new Error('timestamp exceeds PostgreSQL storage bounds');
  }
  // Ordinary UTC input already contains the validated calendar fields. Reuse
  // them rather than decomposing the microseconds into those fields again.
  const sql =
    zone === 'Z' && year > 0 && match[1]?.length === 4
      ? `${value.slice(0, 10)} ${value.slice(11, 19)}.${(match[7] ?? '').padEnd(6, '0')}+00`
      : sqlTimestamp(micros);
  return { micros, sql };
}

/** Produces UTC ISO text directly in SQL, preserving microseconds and expanded years. */
export function utcSql(expression: string): string {
  return `CASE WHEN ${expression} IS NULL THEN NULL ELSE
    (CASE WHEN extract(year FROM ${expression} AT TIME ZONE 'UTC') < 0 THEN
      CASE WHEN extract(year FROM ${expression} AT TIME ZONE 'UTC') = -1 THEN '0000'
      ELSE '-' || lpad((abs(extract(year FROM ${expression} AT TIME ZONE 'UTC')::int) - 1)::text, 6, '0') END
    WHEN extract(year FROM ${expression} AT TIME ZONE 'UTC') > 9999 THEN
      '+' || lpad(extract(year FROM ${expression} AT TIME ZONE 'UTC')::int::text, 6, '0')
    ELSE to_char(${expression} AT TIME ZONE 'UTC', 'YYYY') END)
    || to_char(${expression} AT TIME ZONE 'UTC', '-MM-DD"T"HH24:MI:SS.US"Z"') END`;
}

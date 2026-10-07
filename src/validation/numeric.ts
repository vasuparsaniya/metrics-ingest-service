/** Validates and normalizes a finite plain decimal within PostgreSQL NUMERIC bounds. */
export function decimal(value: unknown): string {
  if (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(value)) {
    throw new Error('value must be a decimal string');
  }
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [whole = '', fraction = ''] = unsigned.split('.');
  const integer = whole.replace(/^0+/, '') || '0';
  if (integer.length > 131072 || fraction.length > 16383) {
    throw new Error('value exceeds PostgreSQL NUMERIC storage bounds');
  }
  const fractional = fraction.replace(/0+$/, '');
  const zero = integer === '0' && fractional === '';
  return `${negative && !zero ? '-' : ''}${integer}${fractional ? `.${fractional}` : ''}`;
}

/** Validates decimal-string series IDs without JavaScript integer precision loss. */
export function seriesId(value: unknown): string {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new Error('seriesId must be a positive BIGINT string');
  }
  const normalized = value.replace(/^0+/, '') || '0';
  if (
    normalized.length > 19 ||
    BigInt(normalized) < 1n ||
    BigInt(normalized) > 9223372036854775807n
  ) {
    throw new Error('seriesId is outside the positive BIGINT range');
  }
  return normalized;
}

/** Encodes exact counts as JSON numbers when safe, otherwise as decimal strings. */
export function exactCount(value: string): number | string {
  const integer = BigInt(value);
  return integer <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(integer) : value;
}

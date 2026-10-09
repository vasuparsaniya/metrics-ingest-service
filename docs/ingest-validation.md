# Ingest row validation

This document records implemented API row-validation rules. Database types are described in [database-design.md](database-design.md); request-key behavior is described in [request-idempotency.md](request-idempotency.md).

## Measurement values

- Accept values as decimal strings, including whole numbers, decimals, negative values, and zero. Examples: `"100"`, `"25.75"`, `"-10.75"`, `"0"`.
- Validate each value in pure ingest-validation logic before building the SQL batch.
- Pass valid strings through parameterized SQL to PostgreSQL NUMERIC without converting them to JavaScript Number. The database stores numeric values, not text.
- Reject invalid values by input index and reason; valid rows in the same batch remain eligible for insertion.
- Validate decimal syntax and supported size before insertion. Never silently round unsupported input. NaN, infinity, booleans, and nonnumeric text are invalid.
- Grammar: optional minus, one or more integer digits, and optional decimal point followed by one or more fractional digits. Scientific notation, whitespace, plus signs, `.5`, and `1.` are rejected.
- Native NUMERIC bounds are 131072 significant integer digits and 16383 fractional digits. Leading integer zeroes do not consume significant digits. Normalize negative zero and insignificant decimal zeroes for point comparison; preserve original strings in request fingerprints.
- The proposed 20 integer / 10 fractional digit cap and later 128-character value cap were not adopted.

Decimal-string input avoids precision loss during ordinary JSON-number parsing. Pre-insert validation supports the PDF's partial-success requirement: relying only on database errors could abort the statement containing otherwise valid rows. Database constraints remain a safeguard where appropriate, rather than a substitute for row validation.

## Measurement timestamps

- Accept ISO 8601 timestamp strings with an explicit timezone: UTC `Z` or an offset such as `+05:30`.
- Examples: `2026-10-07T10:00:00Z`, `2026-10-07T10:00:00.123456Z`, `2026-10-07T15:30:00+05:30`.
- Fractional seconds are optional and may contain up to six digits, matching PostgreSQL microsecond precision. Reject finer precision rather than rounding.
- Reject timestamps without timezone information, invalid calendar dates, and unsupported inputs by index before SQL insertion.
- Preserve microseconds during parsing and canonicalization rather than round-tripping the full timestamp through JavaScript Date.
- Store the absolute instant in TIMESTAMPTZ. Equivalent timezone-offset representations identify the same instant; the original timezone label is not stored.
- Configure UTC for database/session output and return UTC timestamps from the API. PostgreSQL's displayed timezone is a session setting, distinct from its stored instant.

Explicit timezone input prevents machine-local timezone ambiguity. UTC output provides a consistent representation, while supported precision preserves timestamp-based point identity. These format choices are documented assumptions; the PDF requires timestamp validation and correctness but does not prescribe the format.

The proposed application year restriction of 0001–9999 was not adopted. The parser supports four-to-six-digit years with an optional sign, including astronomical year zero and expanded years. UTC normalization uses integer calendar arithmetic and bigint microseconds, checked against PostgreSQL's Julian-day bounds. Reject leap seconds, 24:00, and offsets outside PostgreSQL's supported ±15:59 range.

## Validation scope

The HTTP path currently validates in 100-point internal chunks (a scheduling
experiment reduced from 250) and yields to Node's I/O loop
between chunks. Successful repeated ID and decimal normalization is reused only
inside the same batch; timestamps, invalid inputs and every original rejection
index retain the same validation rules. Chunking does not create separate database
transactions or change the 5,000-point maximum. All candidates are grouped across
the complete batch before insertion.

Use boundary validation in code and essential database constraints. Do not add the declined arbitrary numeric-length, year-range, or query-bucket caps. Previously agreed name and idempotency-key limits remain in effect. The PDF's 5,000-point maximum, per-row rejection, faithful storage, and overload shedding with HTTP 429 are implemented. A separate 16 MiB transport-body ceiling bounds parser allocation without restricting individual decimal scale; initial admission and timeout behavior are documented in the README and still require full-load measurement.

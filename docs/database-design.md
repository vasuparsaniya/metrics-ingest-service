# Database design decisions

This document records the agreed schema implemented by migrations 001–003. Performance and index comparisons are still pending.

## Series identifiers

- `series.id`: `BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY`.
- Future `measurements.series_id`: `BIGINT`, referencing `series.id`.
- Return identifiers as decimal strings in JSON to preserve the full BIGINT range without JavaScript integer precision loss.

BIGINT uses an 8-byte key, compared with a 16-byte UUID. Compact keys reduce the space used by repeated series references and their indexes across two million measurements. PostgreSQL generates the IDs directly, and this single-database assignment does not need independent UUID generation. Neither option requires an extension for its data type.

## Series names

- `series.name`: `VARCHAR(200) NOT NULL`, with a constraint rejecting empty names.
- Trim surrounding whitespace before storage and accept 1–200 characters after trimming. API validation must match PostgreSQL character-length semantics.
- Names need not be unique; the series ID identifies each series.

VARCHAR(200) makes the size bound explicit in the schema and prevents unnecessarily large names. The PDF does not specify a name length; 200 characters is our documented application limit. TEXT with an equivalent constraint would also work without a meaningful performance difference. CHAR is unnecessary because names vary in length and it pads shorter values with spaces.

## Measurement values

- `measurements.value`: `NUMERIC`, without a declared precision or scale.
- Accept decimal-string input and validate rows before SQL insertion without converting values to JavaScript Number. Negative values and zero are supported. See [ingest-validation.md](ingest-validation.md) for API rules and pending bounds.

NUMERIC preserves accepted finite decimal values and exact sums within PostgreSQL bounds, matching the assignment's accuracy requirement. DOUBLE PRECISION approximates many decimal values. No domain-specific decimal-place limit is imposed; validation uses native storage bounds. Throughput, latency, and storage costs must be measured.

## Measurement timestamps

- `measurements.ts`: `TIMESTAMPTZ NOT NULL`, with PostgreSQL's microsecond precision and no millisecond-only restriction.
- Require an explicit timezone in input; return timestamps in UTC.
- Equivalent timezone-offset representations of the same instant identify the same point within a series.
- Preserve microseconds during validation, identity comparison, and serialization; do not round-trip through JavaScript Date where it would discard sub-millisecond precision.
- Accept ISO 8601 strings with explicit `Z` or timezone offsets and optional fractional seconds up to six digits; validate real calendar dates before insertion. See [ingest-validation.md](ingest-validation.md).
- Reject finer-than-supported timestamp precision instead of silently rounding it. Native bounds and expanded signed years are supported; leap seconds and 24:00 are rejected. See row validation for the implemented grammar.

TIMESTAMPTZ represents an absolute instant, which suits timestamp-based point identity and ordering across timezone offsets. Plain TIMESTAMP stores a clock reading without timezone semantics and would require a separate UTC-only convention. The PDF does not require a millisecond limit, so the earlier TIMESTAMPTZ(3) proposal was not adopted.

## Point identity and duplicates

- Enforce point identity with `PRIMARY KEY (series_id, ts)` on measurements. Value is not part of identity.
- Same identity and numerically equal value: count as a duplicate; do not change stored data. Decimal spellings such as `25.5` and `25.50` represent equal values.
- Same identity and different value: reject the incoming row by input index with a conflict reason; do not overwrite the stored value.
- Within a batch, the first valid occurrence is the candidate for insertion. Later equal occurrences count as duplicates; later differing occurrences are rejected. Existing stored data takes precedence over batch candidates.
- Across concurrent batches, the successful insert whose transaction commits establishes the stored value. Matching concurrent submissions must not create multiple rows; conflicting submissions must be classified against the committed value.
- Good rows continue to be stored when another row is rejected.

The PDF defines identity and replay correctness but does not specify a different-value policy. Keeping the first committed value preserves previously stored measurements, while indexed conflict rejections expose inconsistent inputs. Database constraints and conflict-aware batch SQL must enforce this under concurrency, rather than select-then-insert logic. Response counts must account for each input row exactly once, including when a batch candidate conflicts with existing data.

## Ingest request table

HTTP header validation, request fingerprinting, replay, concurrency, transaction flow, and retention are documented in [request-idempotency.md](request-idempotency.md). This section covers database columns and their rationale.

| Column            | Type and constraints                                                                          | Reason                                                                                                                                                                                                                                                 |
| ----------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `idempotency_key` | `VARCHAR(128) PRIMARY KEY`; non-empty printable ASCII excluding spaces and control characters | Explicitly bounds client-controlled key storage. The primary key enforces one request record per key and coordinates concurrent claims. No UUID format is required.                                                                                    |
| `payload_hash`    | `BYTEA NOT NULL CHECK (octet_length(payload_hash) = 32)`                                      | SHA-256 produces 32 raw bytes. BYTEA stores those directly rather than 64 hexadecimal characters. Node.js generates a Buffer, which pg can send as binary data.                                                                                        |
| `response_body`   | `JSONB`, temporarily nullable during key claim                                                | Stores the structured ingest response, including counts and indexed rejection reasons, for replay without storing the original measurement payload. JSONB preserves the response's JSON meaning, not its original formatting or object-property order. |

Measurement rows do not require a foreign key to request records: point identity and request replay are separate responsibilities. The request-table primary key is the only planned index for this table; no cleanup index is needed under the agreed retention policy. The write path must populate `response_body` before committing.

## Implementation and remaining verification

- Numeric and timestamp validation follow [ingest-validation.md](ingest-validation.md).
- Query boundaries, UTC bucket alignment, empty-bucket behavior, bucket last-point shape, aggregate representation, and latest-point responses are finalized in [query-design.md](query-design.md). The finite precision of repeating averages is an explicit assumption.
- Only primary-key indexes are present. Measure plans and write cost before adding or deleting indexes.
- Performance targets and full-volume reconciliation remain unverified.

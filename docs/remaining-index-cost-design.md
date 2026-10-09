# Remaining required-index write-cost design

## Scope and safety

Measure `series_pkey` and `ingest_requests_pkey` independently using fresh,
UUID-named experiment tables in an explicitly selected existing local database
other than the main environment database. Never alter business tables, their
indexes, or existing experiment data. Retain experiment tables for inspection.

## Method

For each business table, create two schema-equivalent copies, including checks,
NOT NULL rules and (for series) identity generation. Add a primary key to both,
then physically drop only the no-index variant's primary key. Check catalog
evidence that the variants differ only in that index/constraint.

Use identical ordered plain INSERT statements in both variants, without
ON CONFLICT. Series use generated bigint identities and deterministic names.
Requests use distinct opaque keys, deterministic 32-byte hashes and the same
completed-response JSON object. Include driver encoding and database writes in
timing; exclude DDL, verification, and report generation. No API or SHA-256 work
is measured.

Run a small smoke test first, then a synthetic 100,000-row comparison per
variant, with 5,000-row batches and eight workers. This larger sample measures
insertion cost; it does not represent 100,000 requests or series in the original
two-million-point acceptance workload (400 batches and eight series). Report
rows/sec, duration and index bytes independently for each table. Do not convert
these rates into measurement points/sec or claim they explain HTTP latency.

Verify exact row counts, expected key/identity coverage, deterministic payloads,
and actual constraints/indexes after timing. Drain active workers on failure;
never report a failed comparison as success. Generate unique JSON and Markdown
reports and embed successful results, commands and limitations in README.

## Alternatives and limitations

The actual eight-series/400-request sample is more representative in size but
too short for reliable timing. HTTP tests are useful end-to-end evidence but
cannot isolate index maintenance from hashing, validation and other writes.
The synthetic direct-insert comparison is therefore preferred for this task.
Sequential indexed-first runs remain sensitive to cache, checkpoints and host
noise; a single percentage is observational, not a precise causal estimate.
Production primary keys remain required for identity and idempotency.

## Verification and delivery

Unit-test guarded identifiers, equivalent SQL, workload sizing and report labels.
Run real PostgreSQL smoke comparisons, then standard typecheck/lint/tests/build
before full measurements. Do not run other heavy checks during timed writes.
Keep artifacts ignored. No production migration, commit or push is authorized.

Design self-review: scope, row counts, safety boundaries and reporting units are
explicit; no pending design placeholders.

# Measurements primary-key write-cost plan

**Goal:** Measure the actual write cost of measurements_pkey without touching
main tables or pretending an unsafe schema is production-ready.

**Approved method:** Require an explicit non-main local database and an existing
manifest whose eight series exist. Create two fresh UUID-named bench tables LIKE
measurements INCLUDING CONSTRAINTS, adding a primary key and the same series FK
to both. Physically drop only the second table's primary-key constraint/index,
without CASCADE. Keep NOT NULL, CHECK and FK constraints identical. Insert the
same generated unique points through identical ordered plain UNNEST INSERTs,
5,000 per autocommitted statement, eight workers. Neither uses ON CONFLICT, since
that requires the unique index. Keep both tables/data for inspection.

This is a direct database write-kernel comparison, not API acceptance. Timings
include identical per-batch generation, pg encoding, connection acquisition and
SQL, but exclude table DDL and reconciliation. Report absolute throughput,
duration, exact per-series counts/sums, actual constraints/indexes and sizes.
Do not substitute these rates for HTTP throughput. Sequential order and shared
host/checkpoint/cache effects remain limitations; repeat runs before attributing
an exact percentage causally. No series/request/migration index cost is measured.

## Steps

- [x] Add `scripts/load/primary-index-cost.ts` for guarded SQL, two-table
      measurement and Markdown summary; add `scripts/primary-index-cost.ts` CLI
      entrypoint plus package command `index:cost`.
- [x] Unit-test experiment table identifier rejection and identical INSERT SQL
      across variants, no conflict handling, Markdown diagnostic labels and metrics.
- [x] Run a 40,000-point smoke experiment on the existing isolated benchmark
      database; verify the dropped table has no indexes and both reconcile exactly.
- [x] Run typecheck, lint, unit tests and build without concurrent measurement.
- [x] Run the authorized 2,000,000-point comparison on isolated tables in
      metrics_benchmark_covering_fresh_02 and embed the actual results in README.

No benchmark table is dropped or overwritten. Main business tables receive no
inserts. Existing experimental indexes on measurements are not copied. All
artifacts receive unique names and stay ignored. JSON plus Markdown are generated
after measured writes. No commit or push is requested.

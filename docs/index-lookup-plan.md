# Required-index lookup evidence plan

**Approved scope:** Capture real plans and timings for latest/range measurement
reads, series identity and request replay lookups on physically indexed/unindexed
isolated copies. Reuse existing cost reports; no new load or production changes.

**Architecture:** `scripts/load/index-lookup.ts` validates untrusted report/table
inputs, checks row counts and actual catalogs, analyzes only owned test tables,
compares results and alternates 20 timed queries per variant, then captures text
EXPLAIN (ANALYZE, BUFFERS). `scripts/index-lookup.ts` owns local database guarding,
CLI parsing and unique JSON/Markdown artifacts. README embeds all eight plans.

**Alternatives:** Planner flags alone leave physical indexes in place; dropping
business indexes endangers correctness. Existing separate copies are preferred.

- [x] Add unit tests in `src/validation/index-lookup.spec.ts` for report validation,
      unrelated/injected names, swapped schemas and SQL variants.
- [x] Implement pure validated pair parsing and parameterized lookup SQL plus
      real SQL comparison; reject absent, mismatched or unexpected index/data evidence.
- [x] Add `index:plans` package command, explicit local non-main database, two cost
      report arguments, unique JSON and REPORT.md; no startup or migration required.
- [x] Run typecheck/lint/tests before SQL timings. Run actual four comparisons in
      `metrics_benchmark_covering_fresh_02`, inspect equality/catalog/plan evidence.
- [x] Embed measured timings, all real plans, source commands and limitations in
      README. Keep artifacts ignored and tables retained; no commit/push.

Measurements have two million rows, keys 100,000 synthetic rows; read timings are
direct SQL without load, not HTTP p95. Warmup/cache/order and host noise apply.
Series lookup returns ID only, because concurrently generated identities need
not assign identical names to the same ID in the two insertion runs. Request
payloads and measurement results must match exactly. Reuse existing bucket-plan
evidence rather than an unindexed 720-scan bucket query that can time out.

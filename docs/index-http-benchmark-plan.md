# Indexed/unindexed HTTP benchmark implementation plan

**Goal:** Execute the approved `index-http-benchmark-design.md` without changing
normal API ingestion or running a full load.

**Architecture:** A separate compiled benchmark bootstrap supplies a plain-insert
repository and stats query compatible with both schemas. A guarded runner owns
fresh databases, catalog evidence, HTTP measurements and labelled reports.

**Tech stack:** Existing NestJS, strict TypeScript, PostgreSQL/pg and Jest.

## Task 1: isolated API and schema guards

- [x] Test variant/name parsing and refusal of main/remote/existing databases.
      Names must match `^metrics_index_http_[A-Za-z0-9_]+$` and fit 63 characters.
- [x] Implement `src/benchmark/index-http-main.ts` and a benchmark-only module
      with existing guards/filter/interceptor/controllers, shared ingest service
      and a plain-insert repository. Insert keys with
      `INSERT INTO ingest_requests (idempotency_key,payload_hash) VALUES ($1,$2)`;
      insert candidates with ordered UNNEST, no ON CONFLICT in either variant.
- [x] Override only benchmark stats SQL: dropping series PK removes PostgreSQL's
      functional-dependency shortcut, so group by both `s.id,s.name` in both modes.
- [x] Implement `scripts/load/index-http-schema.ts`: create-only local databases,
      apply migrations, drop the measurement FK in both, drop the three business
      PKs only for unindexed, no CASCADE, and verify exact catalog state.
- [x] Unit-test pure options/schema validation and identical insert logic.

## Task 2: runner and reports

- [x] Extend owned-child startup with an explicit benchmark bootstrap selection;
      default remains `dist/main.js`. Never inherit a public benchmark toggle.
- [x] Add bounded workload `maxRetries` option; this runner passes zero. Normal
      workload defaults remain eight and interruption remains zero.
- [x] Implement `scripts/index-http-benchmark.ts` and dedicated options parsing:
      variant/database mandatory, points 8–2,000,000, samples 20–10,000.
- [x] Record cold writes/RSS, exact counts/sums, route correctness and idle reads.
      Continue recording independent checks after read/plan failures. Cap repeated
      failed idle calls and record requested versus attempted samples explicitly.
- [x] Add real EXPLAIN with 30-second transaction-local timeout. Record failed
      plans without invented output; do not change API timeout settings.
- [x] Generate immutable JSON/REPORT.md including variant, actual schema,
      measurements/errors and experiment-only limitations. Preserve partial
      evidence on failure; stop owned processes in finally; never delete data.
- [x] Add package command and both full-run commands to README.

## Task 3: verification and review

- [x] Unit tests for labels, missing evidence, guards and zero retries.
- [x] Small real-PG tests of both variants and all seven existing routes; exact
      count/sum, index/FK assertions, duplicate/replay exclusions and refusal to
      reuse an existing experiment database.
- [x] Spec review then code-quality review; fix findings before final handoff.
- [x] Typecheck, lint, unit/E2E tests, build, formatting and export-JSDoc scan.
- [x] Record results in this plan; give full commands without running full loads.

No commit/push is requested. Existing dirty README/audit changes are preserved.
Unavailable worktree/finishing/TDD companion skills use ordinary tests/review;
implementation stays in the user-selected `feat/ingest` workspace.

## Verification results — 2026-10-09

- Typecheck, lint, build, formatting and diff whitespace checks passed.
- 186 unit tests plus 29 real-PostgreSQL/child-process E2E tests passed (215).
- Both compiled benchmark variants passed 80-point/20-idle-sample runs: exact
  reconciliation, full hourly aggregates, health/readiness/stats/latest routes,
  actual bucket EXPLAIN and physical three-versus-zero business index counts.
- Existing-database refusal preserved its 80 rows; main test database retained
  all three business indexes. Normal API/recovery tests still passed.
- Latest retained smoke databases: `metrics_index_http_smoke_indexed_8602230f`
  and `metrics_index_http_smoke_unindexed_2559f21c`; earlier smoke evidence is
  also retained under ignored artifacts. These tiny runs are not target evidence.
- Syntax-tree audit: all 169 exported declarations have JSDoc; no explicit any,
  non-null assertions or empty catch blocks.
- Independent spec and quality reviews passed. Corrected benchmark application
  metadata to name the actual separate bootstrap. Read failures do not erase a
  complete reconciled write measurement, but still fail the overall experiment.
- Shared schema guards/catalog inspection reside in
  `src/benchmark/index-http-schema.ts` so the src-only production build can load
  the benchmark bootstrap. Database creation/migrations remain in scripts.
- Full two-million-point comparisons were not run; production latency targets,
  storage guidance and missing completed full-scale unindexed plans remain open.
- No commit, push, production migration or production database mutation.

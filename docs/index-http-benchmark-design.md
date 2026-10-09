# Indexed/unindexed HTTP benchmark design

## Purpose

Produce reproducible PDF §5 index-cost evidence through HTTP writes and existing
read routes. This is a benchmark-only comparison, not normal API acceptance.
No production migration, index or duplicate/idempotency guarantee is changed.

## Isolation and commands

Add `npm run index:benchmark` with mandatory `--variant indexed|unindexed` and
mandatory fresh local `--database metrics_index_http_<name>` selection. Refuse
the configured main database, remote hosts, existing target databases and
unexpected schema/index state. Both commands create separate databases containing
the same business table names; they do not share rows. The existing Docker
PostgreSQL instance may host them. Resources remain available for inspection.

Examples to document in README after implementation:

```bash
npm run index:benchmark -- --variant indexed --database metrics_index_http_indexed_01 --points 2000000 --samples 100
npm run index:benchmark -- --variant unindexed --database metrics_index_http_unindexed_01 --points 2000000 --samples 100
```

The command launches and stops its own compiled, benchmark-only API child. The
ordinary `npm start`, `load` and `acceptance` commands never enable this mode.
The variant is a runner flag, not an HTTP query parameter or request header.

## Schema comparison

Apply existing migrations only to the freshly created experiment database.
Remove the measurement-to-series foreign key in both variants: the unindexed
series table cannot retain the referenced unique index needed by that FK.
Retain identical column types, identities, NOT NULL and CHECK constraints.

The indexed variant retains the primary keys of `series`, `measurements` and
`ingest_requests`. The unindexed variant physically drops those three primary
keys, without CASCADE. Migration-tracker indexes remain and are explicitly
excluded from the ingestion experiment. Record actual catalog definitions and
constraint state before/after measurement; do not infer state from the flag.

This combined-index HTTP experiment complements existing per-index SQL costs.
It does not isolate each index's individual contribution, and neither schema
is an exact production baseline because both omit the foreign key.

## Identical HTTP write path

Use a separate benchmark bootstrap/module with a benchmark ingestion repository;
reuse authentication, controllers, admission control, validation, fingerprinting,
grouping, parameter encoding, transaction policy and normal read repositories.
Use the same plain INSERT statements for both variants, including request-record
insertion, measurement insertion and saved-response update. No ON CONFLICT is
used in either variant. Verify series existence at the application boundary.

Only unique generated points and request keys are supported. Disable write
retries: a lost response must not silently duplicate an already committed batch.
Any failed or ambiguous write marks the run failed and retains evidence; never
resume or replay this experiment. Do not execute A–G or claim replay/conflict
correctness. Normal API acceptance remains separate.

## Measurements and reports

Reuse the deterministic eight-series, 5,000-point, eight-writer generator and
identical date/value distribution. Default to 2,000,000 points and 100 idle-read
samples; allow smaller explicitly labelled smoke runs.

Record HTTP write latency, newly stored points/sec, API-process sampled RSS,
latest/bucket latency during writes, idle latest/bucket latency, statuses and
failures. Existing series/point/stats/health/readiness routes use the selected
experiment database; their availability and result checks are recorded without
inventing extra performance targets. Capture real bucket EXPLAIN ANALYZE BUFFERS
on the full data with a bounded experiment timeout. Timeouts remain failures,
not fabricated plans; no production timeout setting is changed.

Reconcile exact per-series counts/sums and compare aggregate results with the
generator. Record missing evidence as unmeasured, never zero. A failed write,
read, reconciliation or plan stays visibly failed in the summary.

Each unique artifact directory contains JSON and REPORT.md with a prominent
WITH INDEXES or WITHOUT BUSINESS INDEXES label, database name (no credentials),
machine/settings, measured catalog state, method limitations and evidence links.
Reports distinguish experiment measurements from normal API target compliance.
README documents both commands, prerequisites, execution order, isolation and
report location. No new benchmark is claimed complete until actually run.

## Verification and boundaries

Unit tests cover option/schema guards, identical variant insert SQL, disabled
retry policy, report labels and missing/failed evidence. Small real-PostgreSQL
HTTP tests cover both variants, all reused route families, exact reconciliation,
index catalog assertions and protection of normal behavior. Run typecheck, lint,
unit/E2E tests, build and formatting before handing off full commands.

Run experiments sequentially, not alongside another heavy session. This design
does not promise index-free bucket queries will complete, improve latency or
meet assignment performance budgets. No commit, push or full load is authorized
by writing this design.

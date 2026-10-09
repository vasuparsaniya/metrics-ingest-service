# Consistent acceptance and index-experiment report layout

The user approved separate measurement commands with matching Markdown formats.
No workload, database, API, retry or measured-result changes are included.

## Design

Both reports show run/mode, Performance targets (Checkpoint/Actual/Target/Result),
Additional measurements, Scenarios A–G, Machine, Errors and pending verification,
and Evidence. Index reports retain schema/EXPLAIN/verification attempts as extra
evidence sections. Acceptance identifies the normal API and its expected default
production schema, without pretending it has independently inspected indexes.

Index target comparisons use the same five PDF budgets, but are labelled
experimental, never production compliance. Small runs and missing measurements
remain Not measured; failed read attempts prevent a passing latency checkpoint.
Only complete reconciled full-scale writes support throughput comparison.
Scenarios B/C/D/E/G are Not applicable, since this benchmark does not execute them.
Existing JSON is immutable; new commands generate the layout automatically.

## Implementation and verification

- [x] Add renderer tests for matching headings/table, both mode labels, small and
      failed/missing evidence, and unsupported scenarios.
- [x] Update `scripts/load/index-http-report.ts` and normal acceptance mode label
      in `scripts/load/report.ts`; preserve evidence and experiment caveats.
- [x] Add a report-only index JSON option to `scripts/report.ts`, so an existing
      run can receive a new Markdown summary without writes, loads or overwritten
      historical REPORT.md. Explicitly label it regenerated from original JSON.
- [x] Document common layout and report-only command in README.
- [x] Run unit tests/typecheck/lint/build/format checks; render the existing indexed
      JSON to a new summary and inspect it without any database access.

No commit/push, new benchmark or artifact overwrite is requested.

## Verification — 2026-10-09

Two layout regressions failed before implementation and passed afterward.
Typecheck, lint, 195 unit tests, build, formatting and three focused real-PostgreSQL
index-command E2E tests passed for both small variants and existing-database safety.
No new full-scale load was run. All 174 exported symbols are documented, with
no explicit any, non-null assertions or empty catch blocks.

Rendered the user's successful indexed run `ba088dda` through `npm run report`.
The new `REPORT-regenerated-e5b42af8-53ed-4ba8-b4d6-da79511b2f4b.md` uses the shared
layout. Original JSON and REPORT.md SHA-256 hashes were unchanged. This summary
shows successful correctness execution but failed experimental latency budgets;
it does not replace normal API target evidence.

Experimental source values: 2,000,000 rows, 61,885.24 points/sec, latest during
writes p95 105.86 ms, idle bucket p95 207.14 ms, sampled RSS 230.13 MiB.
These are original measured values, not a new benchmark or a paired index-cost
comparison. Unindexed results remain independent.

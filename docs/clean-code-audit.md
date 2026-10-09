# PDF §7 clean-code audit

Audit date: 2026-10-09. This is a source review, not a new performance run or
fresh-clone verification. Runtime behavior and database queries are unchanged.

## Findings and changes

- TypeScript `strict`, `noUncheckedIndexedAccess` and `noImplicitOverride` are
  enabled. A TypeScript syntax-tree scan of `src`, `scripts` and `test` found no
  explicit `any`, non-null assertions or empty catch blocks.
- The same scan inspected 153 exported declarations. Six lacked attached
  JSDoc: four report-formatting helpers and the restart observer's activity
  interface/error class. Added comments explaining their evidence-preservation
  and safety purpose. A bare `export {}` is a module marker, not a public symbol.
- Validation, grouping, canonical hashing, SQL construction and report rendering
  have pure helpers with unit tests; database/process/filesystem operations are
  kept in repositories and script runners. Production folders are feature-based.
- Reviewed application logging: HTTP request IDs, ingestion keys, counts,
  durations and outcomes are structured. Application error logs omit SQL,
  authorization headers, row values and batch bodies. CLI help/error output is
  intentionally human-readable and is not application request telemetry.
- Reviewed failure paths: transactions rethrow after rollback; expected boundary
  errors become HTTP errors or per-row rejections; workload/experiment failures
  remain recorded evidence. Readiness polling tolerates temporary startup
  connection failures but fails at its deadline. These are intentional handling,
  not empty catches. Cleanup preserves CPU-profile failures after stopping the
  child process.
- No TypeScript suppression directives or TODO/FIXME markers were found in the
  searched source/test directories. Retained baseline SQL and experimental
  scripts have comparison consumers; they are not removed as dead code.

## Scope limits

“Small” and “single-purpose” are qualitative review criteria, not a PDF line-count
limit. This audit does not prove the absence of every redundant branch. No
architecture rewrite, dependency upgrade, load or latency claim is included.
The documented latency, storage and indexing-evidence gaps remain open.

## Verification

- Export scan after edits: all 153 declarations have attached JSDoc; no explicit
  `any`, non-null assertions or empty catches.
- Typecheck, ESLint, all 176 unit tests, build and formatting passed.
- No new database load or benchmark was run. Real-PostgreSQL E2E tests were not
  rerun for these documentation-only changes; their prior result remains 26
  passing tests at `60eb96d`.

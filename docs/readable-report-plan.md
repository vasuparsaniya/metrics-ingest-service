# Readable acceptance report

Approved design: REPORT.md in each acceptance run folder is the human-readable entry point. JSON remains immutable evidence. Include run identity, database when recorded, workload/machine, measured targets, A–G correctness, failures and pending independent checks. Correctness-only passed must never imply performance compliance. Smaller loads and replay are not fresh full-scale evidence. Missing values are Not measured, not zero. Older reports without database metadata say Not recorded.

Implementation plan (inline; no commit):

- [x] Test rendering for performance failures, missing/partial runs, replay/smaller runs and safe evidence links.
- [x] Add a pure renderer and exclusive-write generator, integrate generation after acceptance JSON, print its path including on failed runs.
- [x] Add report CLI for existing JSON, update README, generate the user's existing report without database access.
- [x] Verify tests, typecheck, lint, build and formatting. No full load or benchmark database changes needed.

Verification: 52 unit tests and 20 real-database/child-process tests passed, including four new report-rendering tests. Typecheck, lint and formatting passed. Generated artifacts/acceptance-bf576835-8038-4896-81a6-234579022277/REPORT.md from immutable existing JSON. It reports performance failures honestly and marks independent comparison/test evidence as not measured by acceptance. New acceptance summaries record database metadata; the older run correctly says Not recorded. JSON and benchmark data were not modified. No commit was made.

# Readable comparison reports

Approved extension: generate COMPARISON.md beside a comparison JSON, with write throughput, optional-index throughput change/storage cost, read timings, exact reconciliation and actual EXPLAIN evidence. Distinguish SQL timings from HTTP targets and microbenchmark throughput from fresh API ingestion. Missing or failed evidence must not become a passing result. Do not claim production optimization was adopted.

Preserve earlier summaries: if COMPARISON.md already exists, use the input JSON basename with .md instead. Exclusive creation prevents overwriting either. Existing comparison JSON can be rendered by npm run report -- --input <path>, with no database access. Automatic generation occurs after benchmark completion, never inside timing windows. Failure reports get a readable summary too. New JSON includes database/workload identity without credentials. Do not rerun the heavy comparison just to create Markdown; no commits authorized.

Inline plan:

- [x] Write renderer regression tests for accurate costs, timeouts, missing/failure data and rejection of unrelated JSON.
- [x] Reuse Markdown helper functions, add comparison renderer/generator and extend the report CLI dispatch.
- [x] Integrate automatic summaries safely after compare writes success/failure JSON; do not overwrite success JSON if Markdown generation fails.
- [x] Update README, summarize the user's existing comparison and inspect its output.
- [x] Verify typecheck, lint, unit tests, formatting and build. No API behavior changes or benchmark rerun.

Verification: 56 unit tests passed, including four comparison tests and acceptance-rendering regressions. Typecheck/lint passed. The generator created COMPARISON.md from the existing full-scale comparison-1791350566416-edbef258-34b5-4854-a8a0-f0f1d15db163.json under dataset ee1a8da8-4de7-45ac-acec-2e9de6412f7c. Reviewed the actual strategy throughputs, -24.69% index throughput change, +32.78% write duration, -15.84% SQL bucket p95 change, relation sizes and raw EXPLAIN/timeout evidence. Older omitted identity fields are honestly Not recorded. No JSON/benchmark data changes or new comparison run; no commit. Real-database E2E suites were not repeated for this report-only change.

# Load and acceptance tooling implementation plan

**Superseding database-selection decision:** See `database-selection-plan.md`. Commands now default to DATABASE_URL and accept --database for local isolation; the original dedicated-only policy below is historical.

**Goal:** Provide reproducible HTTP load, replay, reads-under-load, restart, and exact reconciliation commands for PDF scenarios A–G, without running the full load during implementation.

**Architecture:** TypeScript CLI tools generate batches lazily and start a compiled application child process against a dedicated local benchmark database. A persisted run manifest fixes series IDs, point generation, request keys, and expected exact sums. Reports contain actual measurements, never inferred target compliance. Existing development/test databases are refused by the production CLI.

**Tech stack:** Existing Node.js, TypeScript, pg, built-in fetch, child_process, and filesystem modules. No new runtime service or dependency. No commits are authorized for this stage.

The user approved deterministic generation, persisted replay details, JSON reports, scenarios A–G, and checking with a small dataset before the full two-million-point run. Measurements and optimization remain a subsequent checkpoint. Postman/manual loops cannot provide reproducible concurrency, restart state, and machine-readable evidence; a single giant in-memory dataset needlessly consumes client memory. The CLI instead holds at most one batch per writer.

## File responsibilities and execution checkpoints

- [x] `scripts/load/generator.ts`: deterministic point/batch generation and exact fixed-scale expected counts/sums. `src/validation/load-tools.spec.ts` tests identity, negative decimals, repeatability, and batch boundaries.
- [x] `scripts/load/metrics.ts`, `http.ts`: nearest-rank p95, status/error/retry accounting, bounded retries preserving bodies/keys, HTTP response narrowing. Tests cover percentiles and response validation.
- [x] `scripts/load/runtime.ts`, `rss.ts`, `manifest.ts`: local benchmark database guard, migrations, managed compiled process, portable API-child RSS sampling over IPC, exclusive manifests/report files, machine metadata, persistent manifest validation. Never delete existing rows/databases.
- [x] `scripts/load/workload.ts`, `reconcile.ts`: eight bounded concurrent writers, before/after row counts, SQL per-series exact sums, HTTP stats, all hourly aggregates checked against independently generated expected results, concurrent latest/bucket readers. Replay compares complete aggregate snapshots.
- [x] `scripts/load.ts`, `benchmark.ts`: working package commands, default 2,000,000 points/5,000 batches/eight writers, small verification options, explicit manifest replay, reports with actual target pass/miss flags.
- [x] `scripts/load/scenarios.ts`, `acceptance.ts`: isolated scenario series for C–E; deterministic G workload interrupted after an observed mid-batch lock and rerun after restart; persisted reports. Existing A data is not polluted.
- [x] `scripts/load/compare.ts`: independent benchmark tables comparing UNNEST with parameterized multi-row VALUES and an optional secondary index, preserving identity constraints. Real plans/timings saved as evidence, without altering business tables or claiming an unmeasured improvement.
- [x] `package.json`, `.gitignore`, `.env.example`, `README.md`: runnable commands, dedicated database rules, report locations, clean-clone load and separate benchmark commands, scope/evidence caveats.
- [x] Verify with `npm run format`, `npm run check`, `npm run format:check`, then a small isolated CLI run/replay/benchmark/acceptance. Do not run the full two-million-point workload before database confirmation. Update this plan with actual verification outcomes.

## Verification expectations

Generation test: `batch(manifest, 0)` is stable; all generated `(seriesId, ts)` identities are unique; exact sum uses BigInt cents, not floating point. Reconciliation compares count and sum for every manifest series and fails on any discrepancy. A load report distinguishes original accepted counts from newly stored rows on replay. Latency includes error/status accounting and is end-to-end HTTP; RSS measures the child application, not the generator or database.

Scenarios C–E use their own series. G SIGTERMs only the child process started by this CLI, never an arbitrary PID; retries use identical original bodies and keys after restart. Fresh benchmark runs create new manifest series and do not clear databases; a second full cold run needs a different dedicated database if total database count must remain exactly two million. Strategy experiments use isolated named tables with persisted report artifacts and never drop production indexes.

## Actual verification checkpoint — 7 October 2026

`npm run check` and `npm run format:check` passed: 44 unit tests, 18 real-PostgreSQL API/restart tests, typecheck, lint, and compiled build. No new dependencies were needed.

The CLI acceptance command passed first with 5,000 points and then with 40,000 points/eight writer batches. The strengthened C scenario tests fresh same-key coordination and fresh different-key/reversed-order point races with no retry concealing lock errors. G's 40,000-point run committed 35,000 points before restart, verified zero persisted rows/key from the blocked first batch, resumed to exactly 40,000, and replayed without changes.

`load`, replay, `benchmark --samples 20`, and `compare` passed on a separate 40,000-point dataset. The comparison saved actual production/indexed/index-disabled bucket plans, lookup plans, relation sizes, and both strategy timings. A parameter-array bug in the size-report query was found by this verification and fixed before rerunning successfully; the failed run's tables/report were retained, not silently deleted.

Local verification artifacts are under `artifacts/e16dc160-416d-455b-9739-32d7c585f078/` and `artifacts/acceptance-e2219fe3-02c3-4eea-bff8-ccf9ea624577/`. The primary verification databases are `metrics_benchmark_writers_20261007` and `metrics_benchmark_acceptance_20261007`; acceptance also retained dedicated case/restart databases. Existing `metrics` and `metrics_test` business data was not cleared. Artifact files are intentionally ignored by Git.

These small runs verify the tooling, not the full assignment targets. The two-million-point runs, clean-clone installation rehearsal, final full-scale results/diagnosis, evidence-backed optimization, and submission PR are still pending. No commit was created during this tooling stage.

Subsequent portability update: Linux-only `/proc` sampling was replaced with benchmark-only `process.memoryUsage.rss()` self-measurement over IPC. Setup invokes npm through Node, shell-independent `.env` instructions are documented, and native Windows termination is explicitly distinguished from POSIX SIGTERM. See [the portability plan](runtime-portability-plan.md). Verification passed 48 unit and 20 end-to-end tests on Linux; Windows/macOS are not claimed as tested.

# Restart lock-observation fix

Root cause evidence: scenario G began an eight-writer workload then established an observer under a 1.7-second wall-clock deadline. The failing full-scale run logged the blocked batch's 55P03 after a 3.8-second request, so the observer deadline was tied to request preparation rather than the actual wait state. The API's two-second lock_timeout remains correct.

Approved fix: connect and warm the separate observer before ingestion; poll for up to ten seconds, accepting only an INSERT waiting on the test blocker PID. Fail promptly if the workload ends before the target lock is observed. Save observer/workload failure diagnostics. Preserve SIGTERM, target-batch rollback, zero saved request, resume and unchanged replay checks. Do not lengthen production lock_timeout or pretend recovery passed when observation failed.

Inline checklist:

- [x] Regression-test delayed arrival beyond 1.7 seconds, unrelated blockers, deadline and early workload completion.
- [x] Add bounded observation helper and integrate a preconnected observer with the test blocker PID; preserve cleanup and diagnostics.
- [x] Correct report semantics so configured POSIX support is not labelled verified SIGTERM when G failed.
- [x] Run full checks/build then a small isolated acceptance run; record results and leave changes uncommitted.

Verification: all 81 tests passed (59 unit, 22 real-database/child-process); typecheck, lint, build and formatting passed. `npm run acceptance -- --points 40000 --samples 20 --database metrics_benchmark_restart_fix_20261007` completed A–G successfully. G interrupted with 35,000 committed rows, verified zero target-batch rows and no persisted target request, resumed to exactly 40,000, then replayed unchanged. Evidence: artifacts/acceptance-0cb69e6b-3c5c-44ab-8037-1708f197c435/REPORT.md and its linked interruption report. This is a small eight-writer correctness verification, not new full-scale performance evidence. Test databases and evidence are retained; existing user data/JSON is untouched. Corrected only the misleading POSIX-evidence sentence in the earlier failed run's generated Markdown. Production timeout remains two seconds; no commit was made.

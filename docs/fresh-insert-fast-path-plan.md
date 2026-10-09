# Fresh-insert fast path

Approved design: skip the measurement classification SELECT only when PostgreSQL's
INSERT row count equals the number of deduplicated candidate groups. ON CONFLICT
DO NOTHING returns only newly inserted rows, including under concurrent requests.

## Scope

Keep validation, grouping order, exact values, SQL insertion, primary keys,
idempotency and the existing atomic transaction unchanged. When all candidates
are inserted, accepted equals the group count and duplicates equals the sum of
each group's occurrence count minus one. Existing validation/conflict rejections
remain intact. Any skipped candidate keeps the original classification query.
Zero candidates keep the existing early return. No diagnostics or dependencies
are introduced; mixed batches retain the same fresh-statement concurrency safety.

## Verification steps

- [x] Add repository tests proving the fresh path omits the classification SELECT,
      including internal duplicates, invalid rows and intra-batch conflicts.
- [x] Confirm the fresh-path test fails before implementation (three fresh-path
      tests failed; both fallback tests passed).
- [x] Add the row-count fast path; test mixed/all-existing batches retain the SELECT.
- [x] Run unit and real-PostgreSQL suites, typecheck, lint and build serially:
      79 unit tests and 23 integration/child-process tests passed (102 total).
- [x] User runs fresh full-scale acceptance; compare throughput and latest p95
      with run `5ab9f1f0-b4bc-4091-8d07-6479777296cf` (29,988.61 points/sec,
      latest 185.27 ms). Correctness must pass. Do not claim a gain before measuring.

No commit, push or full benchmark run is part of this implementation step.

## Measured outcome

User-run acceptance: `22d030f8-8bbd-4e1e-84df-07e908d5523a`, reported at
`2026-10-07T18:42:20.556Z` (UTC), database
`metrics_benchmark_fresh_fast_path_01`. Local evidence:
`artifacts/acceptance-22d030f8-8bbd-4e1e-84df-07e908d5523a/REPORT.md`
and its original `acceptance.json`. This summary preserves the results without
requiring git-ignored artifacts.

Both runs used 2,000,000 points, 5,000-point requests, eight writers, pool size 12
and PostgreSQL JIT disabled on the same recorded i3-7020U / Node 20.18.0 /
PostgreSQL 17.11 Linux machine. Extra latency diagnostics were absent in both.

| Measurement                         | Before (`5ab9f1f0…`) | Fast path (`22d030f8…`) | Target                  |
| ----------------------------------- | -------------------: | ----------------------: | ----------------------- |
| Fresh throughput (points/sec)       |            29,988.61 |               39,941.76 | ≥20,000: pass           |
| Latest p95 during writes (ms)       |               185.27 |                  130.71 | ≤50: still fails        |
| 30-day hourly bucket p95, idle (ms) |               224.62 |                  177.13 | ≤150: still fails       |
| Write duration (seconds)            |                66.69 |                   50.07 | Informational           |
| API sampled peak RSS (MiB)          |               226.18 |                  234.09 | <512: pass              |
| Stored measurement rows             |            2,000,000 |               2,000,000 | Exactly 2,000,000: pass |

Observed throughput increased approximately 33.2%; latest p95 decreased
approximately 29.4%. All A–G correctness scenarios passed, including concurrent
deduplication, partial success, unchanged replay and SIGTERM restart recovery.
No acceptance/load errors were reported. Replay stored zero new rows. Additional
fast-path measurements: idle latest p95 5.97 ms; bucket p95 during writes
448.80 ms; replay processed input 130,406.84 points/sec (not insertion throughput).

This first run supports keeping the fast path, but repeated runs are needed to
confirm consistency and separate machine/cache variation. The idle bucket query
was unchanged, so its improvement cannot be attributed directly to this ingest
optimization. Overall acceptance execution passed; performance compliance still
failed because both latency targets were missed. No claim of complete latency
resolution is made.

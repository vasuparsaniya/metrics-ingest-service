# JIT and bucket-query improvement

Approved scope: disable JIT on application and measurement/comparison connections (session startup options, not a global PostgreSQL change), test an indexed per-bucket aggregation rewrite, retain exact decimal/timestamp/empty-range contracts. No schema/index changes, reduced dataset, weakened validation, commit or promise of passing latency targets. Latest-under-write changes require separate measured bottleneck evidence.

Evidence: the original full-scale plan spent 645.624 ms in JIT; a controlled six-query diagnostic showed JIT-on 2266/890/800 ms versus off 581/320/289 ms. These are SQL diagnostic timings, not API p95. Covering index alone improved SQL p95 15.84% and reduced kernel insertion throughput 24.69%, so it is not adopted.

Candidate: generate UTC bucket boundaries safely (retain microsecond upper-bound handling), aggregate only each half-open clipped bucket range via existing PK(series_id,ts), calculate max(ts) with count/sum/min/max/native numeric avg, join the unique measurement for last value. This removes per-measurement date_trunc/hash aggregation while retaining empty buckets and exact values. Compare before adopting; do not claim a speedup without measurements.

Inline checkpoints:

- [x] Add real-connection JIT and query-semantic regression tests; observe the JIT test fail before changes.
- [x] Compare candidate SQL on the existing full-scale database using read-only EXPLAIN.
- [x] Add shared connection startup options, apply them to API/tools, record actual JIT state in reports, adopt only the measured candidate.
- [x] Run full correctness/check/build suite and a 100-sample idle HTTP bucket/latest verification against the existing dataset. Do not insert/replay millions of points during this step.
- [x] Record actual diagnostic results and the remaining fresh-write/latest benchmark work. Leave all changes uncommitted.

## Results of this implementation step

All 78 tests passed (56 unit and 22 real-database/child-process), as did typecheck, lint, build and formatting. The new JIT regression failed with on before configuration changes, then passed with off. Existing tests cover exact NUMERIC output, empty buckets, late data, timezone/microseconds and PostgreSQL native upper-bound years. An extra regression distinguishes last value from max(value) and clips both partial boundaries.

Read-only verification against metrics_benchmark_final_02 confirmed old/new SQL response identity for all eight series (720 hourly buckets each), plus independent full aggregate verification. API queries were measured using the compiled app on its own local port, 100 samples per category, with no writes:

| Check                |    Actual |                       Target | Status             |
| -------------------- | --------: | ---------------------------: | ------------------ |
| Idle bucket HTTP p95 | 314.18 ms |                      ≤150 ms | Still fails        |
| Idle latest HTTP p95 |   6.96 ms | Under-write target is ≤50 ms | Idle evidence only |
| Request failures     |         0 |                            0 | Pass               |

Interleaved JIT-off EXPLAIN execution times on the same database: old query 489.369 / 361.223 / 363.211 ms; new query 170.817 / 194.626 / 174.719 ms. This is a diagnostic improvement, not p95 certification. Evidence including raw JSON plans and recorded JIT state: `artifacts/query-improvement-fe964c22-33e6-45ef-9710-c540969dc0ae/checks.json`.

Remaining: further bucket tuning to meet the HTTP target, fresh-ingestion throughput/RSS/latest-under-write verification, and latest-delay instrumentation if it still fails. No new measurements were inserted into the benchmark database; no optional index, global setting or schema was changed. No commit was made. The previous staged comparison-report changes were preserved.

# Full-scale HTTP index comparison — 2026-10-09

Indexed run: `488fa37d-1f28-4be9-bb0c-80bb39d83c95`, database
`metrics_index_http_indexed_03`. Unindexed run:
`b6b3c6b4-94e0-47cd-a885-a3c75d9a066a`, database
`metrics_index_http_unindexed_01`. JSON and REPORT.md remain in ignored artifacts;
this summary travels with the repository without committing those artifacts.

Both use the same experimental HTTP plain-insert path, 2,000,000 unique points,
5,000-point batches, eight writers and concurrent latest/bucket readers.
Both omit the foreign key; migration-tracker indexes are excluded. These are not
normal API acceptance runs or individual-index maintenance-cost estimates.

| Measurement                                      |                         Indexed |                                                  Unindexed |
| ------------------------------------------------ | ------------------------------: | ---------------------------------------------------------: |
| Actual business indexes, before and after        |                               3 |                                                          0 |
| Stored rows                                      |                       2,000,000 |                                                  2,000,000 |
| Exact per-series counts/sums                     |                            Pass |                                                       Pass |
| Complete reconciled write measurement            |                            Pass |                                                       Pass |
| Throughput, points/sec                           |                       67,513.88 |                                                  51,838.31 |
| Writer wall time                                 |                         29.62 s |                                                    38.58 s |
| Successful writes / failed writes                |                         400 / 0 |                                                    400 / 0 |
| Successful ingest p95                            |                       736.19 ms |                                                1,122.95 ms |
| Latest p95 during writes                         |                        78.32 ms |                                                  615.56 ms |
| Bucket reads during writes, successes / failures |                         114 / 0 |                                                      4 / 8 |
| Idle latest p95, 100 samples                     |                         7.54 ms |                                                  221.10 ms |
| Idle bucket p95                                  |        250.95 ms, 100 successes | No successful sample; first request timed out at about 5 s |
| Sampled API peak RSS                             |               250,703,872 bytes |                                          237,223,936 bytes |
| All hourly aggregate verification                |                            Pass |                               Incomplete: HTTP 429 timeout |
| Bucket EXPLAIN                                   | Completed; execution 259.734 ms |                     No completed output: 30-second timeout |
| Overall evidence checks                          |                            Pass |                      Fail: read/verification/plan timeouts |

Unindexed logs show PostgreSQL cancellation code `57014`, mapped to 429 as
designed. This is a real query-performance failure, not a confirmed data mismatch
or script defect. Missing hourly verification/plans are not passing evidence.
Both write measurements remain valid.

Indexes improve observed reads. Indexed throughput is also higher in this mixed
read/write trial, but slow unindexed reads compete with writes. This does not
isolate maintenance cost or establish a causal percentage from one sequential
pair. Existing per-index SQL experiments provide separate write-kernel evidence.
Normal indexed API latency targets and a completed full-scale unindexed bucket
plan remain unresolved. No production indexes should be removed.

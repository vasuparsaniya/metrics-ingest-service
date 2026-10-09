# Index HTTP aggregate verification transport fix

Date: 2026-10-09. Source run: `index-http-indexed-05a0d0f5-4ae4-4f93-915f-becc3224c87f`,
database `metrics_index_http_indexed_01`.

## Evidence

The run stored 2,000,000 points, exact per-series counts/sums matched, and all
write requests succeeded. The sole reported error was
`Hourly aggregate verification: fetch failed`. No aggregate mismatch was reported.
Idle reads and bucket EXPLAIN subsequently succeeded.

| Original indexed HTTP experiment measurement |   Recorded result |
| -------------------------------------------- | ----------------: |
| Complete reconciled write measurement        |              Pass |
| Newly stored points/sec                      |         72,482.45 |
| Write wall time                              |           27.59 s |
| Successful ingest p95                        |         667.57 ms |
| Latest p95 during writes                     |          85.66 ms |
| Bucket p95 during writes                     |         325.96 ms |
| Idle latest / bucket p95 (100 each)          |  3.80 / 185.21 ms |
| API sampled peak RSS                         | 237,449,216 bytes |
| Direct bucket EXPLAIN execution time         |        144.069 ms |

These are experimental plain-insert numbers, not production acceptance. No
unindexed result or paired percentage is available from this run.

The benchmark child client defaulted to zero retries for writes. Reconciliation
and aggregate verification reused that client, so a transport failure in an
unmeasured GET was treated identically to an ambiguous write. Error handling also
discarded the route and nested transport code when converting the error to text.

## Fix

- `ApiTransportError` retains the original cause, GET/POST method, route without
  query parameters and transport code. It does not add headers, keys or bodies.
- A separate `VerificationReadClient` refuses writes and allows one retry only
  for transport failures during count/sum and aggregate correctness reads.
- HTTP errors, invalid JSON and aggregate mismatches are not retried or hidden.
- Timed idle/concurrent reads, series creation and ingestion remain at zero
  retries. Production API code, transaction behavior and SQL are unchanged.
- JSON/Markdown records every failed/recovered verification attempt separately
  from timed latency samples. Persistent failures still fail the experiment.

## Existing full dataset recheck

An owned benchmark child was started against the existing indexed database.
Only reads were executed; no generator writes, new series or request inserts.

| Check                          | Result                                                    |
| ------------------------------ | --------------------------------------------------------- |
| Rows before / after            | 2,000,000 / 2,000,000                                     |
| Exact counts/sums              | All eight series matched                                  |
| Hourly aggregates              | All eight series matched generated expectations           |
| First bucket transport failure | `UND_ERR_SOCKET` reproduced                               |
| Recovery                       | One GET retry succeeded; original failed attempt retained |
| Verification requests          | Nine logical reads: stats plus eight bucket queries       |

This identifies a socket-level failure and confirms bounded read recovery. The
original failed run did not preserve its nested cause, so an identical low-level
cause there cannot be proven retrospectively. Idle keep-alive socket closure
during CPU-heavy expectation generation is a plausible trigger, not a proven
server bug. The original report remains unchanged; this is a subsequent read-only
correctness check, not a replacement load/latency benchmark.

Regression tests cover one recovered socket failure, persistent failures, no
HTTP-error retries, read-only enforcement, zero write retries and retained causes.

Final verification: 193 unit and 29 real-PostgreSQL/child-process E2E tests passed
(222), plus typecheck, lint, build and formatting. Export audit found all 172
exported declarations documented, with no explicit any, non-null assertions or
empty catches. No commit/push or new full-scale insert run was performed.

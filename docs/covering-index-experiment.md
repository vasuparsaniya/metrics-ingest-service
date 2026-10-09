# Covering index experiment — not adopted

## Scope and decision

Experimental SQL, executed manually only in isolated benchmark databases:

```sql
CREATE INDEX measurements_series_ts_value_idx
ON public.measurements (series_id, ts) INCLUDE (value);
```

The main database, application SQL and migrations remain unchanged. The primary
key was retained. User decision: keep this experimental, not a permanent
migration. No index is dropped automatically. Existing experimental databases
and indexes remain available for inspection.

Configuration: 2,000,000 points, 5,000-point requests, eight writers, pool 12,
JIT off, PostgreSQL 17.11 in Docker, Node 20.18.0, Linux 6.8.0-51, Intel i3-7020U
2.30 GHz (four logical CPUs), RAM 12,442,406,912 bytes. Sequential runs do not
isolate all machine, cache and maintenance variation.

## Fresh-load measurements

| Metric                            | No covering index, 25b93ce8 | Covering index, fb6acb0c | Covering index, d01edefe |
| --------------------------------- | --------------------------: | -----------------------: | -----------------------: |
| Throughput points/sec             |                   50,570.24 |                41,455.34 |                46,296.87 |
| Write duration seconds            |                       39.55 |                    48.24 |                    43.20 |
| Latest p95 during fresh writes ms |                       78.92 |                    94.68 |                    83.51 |
| Idle 30-day hourly bucket p95 ms  |                      166.48 |                   144.68 |                   165.58 |
| Bucket p95 during fresh writes ms |                      458.82 |                   451.69 |                   536.75 |
| API sampled peak RSS MiB          |                      239.03 |                   239.78 |                   234.55 |

- Baseline: 25b93ce8-9e25-4d77-9cef-88bc0c989cf2, UTC
  2026-10-08T02:53:20.681Z, metrics_benchmark_without_hash_fast_path_01.
  This cold load preceded adding the experimental index to that database.
- Indexed load 1: fb6acb0c-5501-4721-ab9c-bd735a4ce08a, UTC
  2026-10-08T03:37:15.427Z, metrics_benchmark_covering_fresh_01.
- Indexed load 2: d01edefe-2d5a-4ec2-ad86-4ff865f8b64d, UTC
  2026-10-08T03:43:42.673Z, metrics_benchmark_covering_fresh_02.

Both fresh indexed databases had migrations and the index created before any
measurement insertion. All reports passed A–G execution/correctness checks,
stored exactly 2,000,000 rows, added zero replay rows and reported no errors.
Acceptance's separate case/restart databases used the existing migrations only;
those scenarios do not certify every indexed-schema edge case. Fresh-write
throughput remained above 20,000 points/sec, but decreased approximately 8–18%
against baseline. Latest latency failed ≤50 ms in both indexed runs. Idle buckets
passed ≤150 ms once, then failed. No claim of full performance compliance.

## Existing-data and maintenance diagnostics

After adding the index to the already populated baseline database, 100 idle HTTP
samples measured bucket p95 132.22 ms and latest p95 4.57 ms at UTC
2026-10-08T03:29:27.279Z. Replay verified unchanged exact counts/aggregates and
zero new rows. This was not a fresh-write measurement. The index built over
existing data occupied 77.375 MiB; indexes maintained during the fresh loads
occupied 136,560,640 and 136,658,944 bytes (about 130.24/130.33 MiB) when inspected.
Storage figures are index-only and exclude heap, other indexes and WAL.

Read-only diagnostics compared five rounds across all eight series, alternating
database order (40 direct SQL calls per database). Results were identical across
rounds and databases. Database 1 median/p95 was 132.50/233.62 ms; database 2 was
153.03/206.99 ms. These diagnostic SQL timings are not HTTP acceptance timings.

Both used the covering index. Database 1's checked aggregate scans had zero heap
fetches. Database 2 had 48,750 heap fetches for series 1 and 49,500 for series 8,
plus 141/144 last-point lookup fetches. Statistics showed vacuum/analyze had run
while ingestion was ongoing, with only part of database 2 marked all-visible.
These findings identify a contributor, not every cause of timing variation.

At user request, plain `VACUUM (ANALYZE) public.measurements` was executed only
in metrics_benchmark_covering_fresh_02, not VACUUM FULL. Visibility statistics
changed from 10,250/11,584 estimated pages to 12,753/12,753. Checked heap fetches
dropped to zero, and direct SQL median/p95 became 121.54/162.34 ms across 40 calls.
Exact row count and checked series 1 bucket results remained unchanged.

The subsequent 100-sample HTTP benchmark, JSON
benchmark-1791431366276-e3bc679d-a70a-47ab-8c4d-911e9e5d686d.json, measured idle
bucket p95 150.101231 ms and latest p95 4.848325 ms. Bucket latency still
technically failed ≤150 ms. Replay added zero rows and all read requests
succeeded. These are explicitly post-maintenance results and do not replace
the original fresh-load report. Report degradation compares older cold timings
with newer idle timings; it is not same-maintenance fresh-write evidence.

## Interpretation and next investigation

The covering index can reduce heap reads, but visibility-map state and machine/
cache variation affect its benefit. PostgreSQL explains this requirement in
[index-only scan documentation](https://www.postgresql.org/docs/17/indexes-index-only-scans.html);
vacuum updates the visibility map as described in
[routine maintenance documentation](https://www.postgresql.org/docs/17/routine-vacuuming.html).

Retain existing production indexes for now. Next compare query-level changes
on identical data with explicit maintenance/cache conditions, alternating order,
exact full-result comparisons and repeated timings before any adoption. Focus on
remaining per-bucket overhead such as repeated timestamp formatting and last-point
lookup; prior single-scan aggregation experiments were slower and not adopted.
Latest HTTP latency during fresh writes needs a separate investigation.

Before any permanent INCLUDE(value) index, also verify native NUMERIC edge
values: an index tuple has size limits, whereas accepted NUMERIC values are
unconstrained. The benchmark's small values do not establish index compatibility
with every accepted value. No new API precision restriction is authorized here.

Raw JSON is retained under ignored artifacts; this document embeds measurements
and decisions so the evidence summary remains readable without those files.

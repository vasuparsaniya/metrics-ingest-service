# Cooperative point grouping implementation plan

**Status:** Removed at user request after two full-scale measurements. Original
synchronous grouping and its exact candidate ordering are restored.

**Goal:** Yield during identity grouping without changing first-occurrence
precedence, duplicate/conflict accounting or deterministic candidate ordering.

**Approved architecture:** Extract a request-local grouper in
`src/ingest/ingest.validation.ts` with add and finish operations. Both the existing
synchronous groupPoints and a new groupPointsCooperatively wrapper share it.
The wrapper in `src/ingest/ingest.processing.ts` adds 100 points per chunk and
awaits setImmediate between chunks; finish retains the existing synchronous sort.
`src/ingest/ingest.repository.ts` awaits the wrapper at its current grouping site.
Filtering, SQL, connection admission and the single batch transaction are unchanged.

Keeping synchronous grouping leaves a whole-batch uninterrupted scan. Moving
deduplication to SQL changes more behavior and resource placement; the approved
scheduling change is the smaller experiment. It may add overhead, and the final
sort is still synchronous. No latency gain is promised before measurement.

## Steps

- [x] Add `src/ingest/ingest.grouping.spec.ts` for empty/small/full batches,
      99/100/101/5000 boundaries, inter-chunk duplicates and conflicts, existing
      rejection indexes, numeric BIGINT/microsecond ordering and request isolation.
      Compare cooperative output with synchronous output and exact fixtures.
- [x] Add a synchronous async wrapper first. Run the dedicated suite and verify
      I/O callbacks have not run before 101/5000-point grouping completes.
- [x] Extract the shared grouper, add 100-point cooperative scheduling, await it
      in the repository. Do not change final sort or response classification.
- [x] Run `npm run check`, formatting and diff checks. Real PostgreSQL concurrency,
      replay, partial-success and restart tests must pass.
- [x] Document as unmeasured in README and give the user a fresh-database
      acceptance command. Compare with removal run 25b93ce8: 50,570.24 points/sec,
      latest write p95 78.92 ms and idle hourly bucket p95 166.48 ms.

Profile api-a4f746e0 sampled about 2.89 seconds inclusive in groupPoints across
the whole API session, not a direct attribution of latest p95. No full-scale
benchmark, commit or push is launched automatically.

Regression evidence: nine correctness cases passed with the synchronous wrapper;
the two callback tests for 101 and 5,000 points failed as expected. Both passed
after adding cooperative scheduling, without changing their output assertions.

Verification: 146 unit tests and 26 PostgreSQL/child-process tests passed (172
total), along with typecheck, lint, build, formatting and whitespace checks.
These checks describe the experiment before removal; SQL and final sorting were
unchanged.

## Full-scale results and removal

Baseline 25b93ce8: 50,570.24 points/sec, latest write p95 78.92 ms, idle hourly
bucket p95 166.48 ms, write duration 39.55 seconds, API RSS 239.03 MiB.

| Metric                    |  dd4b3eec |  849c4612 |
| ------------------------- | --------: | --------: |
| Throughput points/sec     | 47,953.19 | 48,136.41 |
| Latest write p95 ms       |     80.64 |     78.81 |
| Idle hourly bucket p95 ms |    157.54 |    201.76 |
| Write duration seconds    |     41.71 |     41.55 |
| API sampled peak RSS MiB  |    249.07 |    240.29 |

Run dd4b3eec-0010-4509-81cf-8f4e4b54e634: UTC 2026-10-08T03:10:06.359Z,
database metrics_benchmark_cooperative_grouping_01.
Run 849c4612-a9b1-433c-add8-f6035b4b61f1: UTC 2026-10-08T03:14:38.587Z,
database metrics_benchmark_cooperative_grouping_02.

Both used 2,000,000 points, 5,000-point requests, eight writers, pool 12 and JIT
off on the same recorded configuration. All A–G checks and POSIX SIGTERM recovery
passed, with exact rows, zero replay inserts and no acceptance/load errors.
Throughput decreased about 5%; latest p95 was essentially unchanged. Both latency
targets failed. Bucket SQL was unchanged; its variability cannot establish a
grouping effect. Sequential measurements do not eliminate machine/cache effects.

User decision: remove the cooperative wrapper, shared grouper extraction,
repository await and experiment-only grouping test file. The original three
production files are restored exactly to their committed versions. Existing
grouping correctness tests remain; timestamp and parameter optimizations stay.
The removed test file can be recreated from the experiment described above;
its deletion does not remove existing committed tests. No commit or benchmark
is launched automatically.

Post-removal verification: 135 unit and 26 PostgreSQL/child-process tests passed
(161 total), along with typecheck, lint and build. Production rollback matches
the committed code exactly; only README and this experiment record remain changed.

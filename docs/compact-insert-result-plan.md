# Compact insert result

Approved scope: reduce measurement INSERT data sent to Node without changing
point identity, admission, validation, exact values or atomic request transactions.

## Design

A data-modifying CTE retains inserted series IDs and timestamps in PostgreSQL.
Its final SELECT returns one summary row: `insertedCount` as integer, and an empty
`identities` text array for a fully fresh batch. If fewer rows were inserted than
the deduplicated candidate count, a conditional subquery builds the inserted
identity array needed by the existing classification SELECT. The array's order
does not matter; Node uses a Set. An all-existing batch returns zero and an empty
array, then still classifies against stored values.

Do not use the outer SELECT's `rowCount` as the insertion count: it is always one.
Continue classification in a separate READ COMMITTED statement, so a concurrent
conflict winner committed during INSERT is visible. Do not read measurements
from the insert CTE's original snapshot or infer ownership from system columns.
The CTE still captures rows in PostgreSQL; it reduces client transfer/decoding,
not all server-side work. Existing conflict lock ordering stays unchanged.

## Files and verification

- [x] Update `src/ingest/ingest.repository.spec.ts` fixtures to return a one-row
      count/identity summary, and confirm tests fail against the previous code.
- [x] Create documented SQL in `src/ingest/ingest.insert.sql.ts`; consume its
      summary in `src/ingest/ingest.repository.ts`. Preserve the fresh fast path
      and mixed/all-existing fallback tests.
- [x] Add a real PostgreSQL test in `test/api.e2e-spec.ts` proving a 5,000-candidate
      fresh INSERT returns one row with no identities; mixed inserts return only
      new identities, all-existing inserts return zero, and rollback leaves no
      test measurements. Reuse API concurrency, replay and partial-success tests.
- [x] Run `npm run check`, Prettier and diff checks serially: 79 unit tests and
      24 integration/child-process tests passed (103 total), as did typecheck,
      lint and build. Four regression tests failed against the previous code
      before implementation, then all five repository tests passed.
- [x] User runs full acceptance in a fresh named database without additional
      diagnostics. Compare against run `22d030f8-8bbd-4e1e-84df-07e908d5523a`:
      39,941.76 points/sec, latest p95 130.71 ms. Measure before claiming a gain;
      CTE materialization/counting may offset reduced wire work.

The alternative of returning only a count unconditionally loses inserted identity
ownership in mixed/concurrent batches. Returning every identity retains unnecessary
fresh-batch traffic. The conditional summary preserves both paths.

Implement inline. The preceding fast-path change was committed separately; no
commit or push of this new change, or full-scale benchmark launch, is authorized.

## Measured outcome

User-run acceptance `569d4d48-34e2-48c4-92f6-64c67987ddc4`, reported at
`2026-10-07T18:53:24.476Z` (UTC), used database
`metrics_benchmark_compact_insert_01`. Local original evidence is retained under
`artifacts/acceptance-569d4d48-34e2-48c4-92f6-64c67987ddc4/` in `REPORT.md`
and `acceptance.json`. This summary does not depend on those git-ignored files.

Both runs used 2,000,000 points, 5,000-point requests, eight writers, pool size 12
and JIT disabled on the same recorded i3-7020U / Node 20.18.0 / PostgreSQL 17.11
Linux machine, without the removed latency diagnostics.

| Measurement                         | Previous fast path (`22d030f8…`) | Compact result (`569d4d48…`) | Target                  |
| ----------------------------------- | -------------------------------: | ---------------------------: | ----------------------- |
| Fresh throughput (points/sec)       |                        39,941.76 |                    47,089.26 | ≥20,000: pass           |
| Latest p95 during writes (ms)       |                           130.71 |                       118.30 | ≤50: still fails        |
| 30-day hourly bucket p95, idle (ms) |                           177.13 |                       179.32 | ≤150: still fails       |
| Write duration (seconds)            |                            50.07 |                        42.47 | Informational           |
| API sampled peak RSS (MiB)          |                           234.09 |                       232.76 | <512: pass              |
| Stored rows                         |                        2,000,000 |                    2,000,000 | Exactly 2,000,000: pass |

Observed throughput increased approximately 17.9% and latest p95 decreased
approximately 9.5%. Idle bucket latency was essentially unchanged; its SQL was
not modified. Additional measurements: bucket p95 during writes 418.01 ms,
idle latest p95 5.69 ms, replay processed input 166,416.25 points/sec with zero
newly inserted rows. All A–G correctness checks, including restart recovery,
passed; no acceptance or load errors were reported.

These results support keeping the compact result, but one sequential comparison
does not isolate machine/cache variation or establish consistent gains. Overall
acceptance execution passed while performance compliance still failed because
both latency targets were missed. No complete-latency-resolution claim is made.

The user subsequently authorized recording these measurements and committing
the implementation. Push and further implementation are not part of that request.

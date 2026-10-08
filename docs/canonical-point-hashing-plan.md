# Canonical point hashing implementation plan

**Status:** Experiment removed at user request; generic canonical construction
restored. Timestamp optimization and additional hash compatibility tests retained.

**Goal:** Reduce canonical JSON construction work while preserving every saved
request fingerprint and the existing 100-point cooperative scheduling boundary.

**Approved design:** In `src/ingest/ingest.fingerprint.ts`, obtain enumerable own
keys as before. If there are exactly three keys, all three own properties
seriesId/ts/value exist, and all three values are strings, construct fixed
alphabetical key text with JSON.stringify on each value. Otherwise use unchanged
generic recursive sorting. Keep whole-body hashing, extra fields, array order,
original numeric/timestamp spellings, Unicode escaping and SHA-256 unchanged.
No deduplication, validation, SQL or transaction change is included.

Leaving generic construction unchanged keeps repeated sorting/key encoding;
generic shape caching adds complexity and cache growth. The approved narrow
fast path removes repeated work for the common shape with no cache.

## Steps

- [x] Add `src/ingest/ingest.fingerprint.spec.ts`: compare SHA-256 bytes against
      a standalone legacy canonical reference for every point key permutation,
      escaped/Unicode values, extras/missing fields, mixed JSON types and 5,000 points.
      Spy on sorting/stringifying for a standard batch: expect one root sort and
      15,001 stringify calls instead of 5,001 sorts and 30,001 calls.
- [x] Verify the operation-count regression fails before the optimization:
      13 compatibility cases passed; the operation-count case failed with
      5,001 sorts instead of one.
- [x] Add only the guarded fixed-key branch; correct the stale chunk-size JSDoc.
- [x] Run `npm run check`, formatting and diff checks. Existing golden hashes,
      array boundaries, yield callbacks and real PostgreSQL replay tests must pass.
- [x] Document implementation as unmeasured in README.
- [x] User ran unprofiled
      acceptance in a fresh database against f2ac9857: 51,463.39 points/sec, latest
      write p95 72.75 ms, idle hourly bucket p95 152.01 ms.

The previous profile shows canonical self sampling about 7.38% of the whole
session; GC sampling cannot be wholly attributed to hashing. No full-scale gain
is claimed until measured. Preserve existing timestamp changes; do not commit
or run full acceptance automatically.

Verification: 135 unit tests and 26 PostgreSQL/child-process tests passed (161
total), along with typecheck, lint and build. The standard 5,000-point operation
test passed with one sort and 15,001 stringify calls, while matching the legacy
hash. Chunk-boundary scheduling, golden hashes, Unicode escaping, unusual JSON
shapes and real API replay tests passed. Timestamp changes remain in the worktree.

## Measurement and rollback decision

Both runs used 2,000,000 points, 5,000-point requests, eight writers, pool 12 and
JIT off, with all A–G checks and POSIX SIGTERM recovery passing. Stored rows were
exact, replay added zero rows and no acceptance/load errors were reported.

| Metric                    | Timestamp baseline f2ac9857 | Hash 879b1b53 | Hash 8f2d787e |
| ------------------------- | --------------------------: | ------------: | ------------: |
| Throughput points/sec     |                   51,463.39 |     54,610.45 |     49,426.24 |
| Latest write p95 ms       |                       72.75 |         98.88 |        101.58 |
| Idle hourly bucket p95 ms |                      152.01 |        178.80 |        172.75 |
| API peak RSS MiB          |                      239.34 |        228.22 |        225.80 |

879b1b53 was measured at UTC 2026-10-08T02:40:36.473Z in
metrics_benchmark_hash_fast_path_01; 8f2d787e at
2026-10-08T02:45:40.345Z in metrics_benchmark_hash_fast_path_02.
Both latency budgets remained unmet. Throughput benefit was inconsistent despite
lower sampled memory. This is not proof that the fast path caused slower reads:
machine/cache variation and unchanged idle SQL remain confounders.

Remove only the fixed-key branch and its operation-count assertion. Retain all
14 legacy hash compatibility cases; the full-batch case now asserts bytes only.
Rerun acceptance in a fresh database with timestamp optimization still enabled
to test whether baseline-like latency returns. No benchmark or commit is launched
automatically.

Removal comparison 25b93ce8-9e25-4d77-9cef-88bc0c989cf2, UTC
2026-10-08T02:53:20.681Z, database metrics_benchmark_without_hash_fast_path_01:
50,570.24 points/sec, latest write p95 78.92 ms, idle hourly bucket p95 166.48 ms,
39.55-second writes and 239.03 MiB sampled API RSS. All A–G and POSIX SIGTERM
checks passed with exact 2,000,000 rows, zero replay inserts and no errors.
Latest latency returned closer to baseline, supporting removal but not proving
causation. Both latency budgets remain unmet. Post-removal checks passed all 161
tests, typecheck, lint and build. The user subsequently requested committing
these retained changes and documentation; no push was requested.

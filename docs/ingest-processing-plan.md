# Cooperative ingest processing

Original approved approach: process CPU-heavy work in 250-point chunks and yield to Node's
event loop between chunks. This is internal scheduling, not a new HTTP batch limit,
SQL batch boundary, transaction boundary, queue, or service.

## Scope and invariants

- Keep 5,000 points/request, eight admitted ingests with the default pool, and one
  atomic transaction containing the request claim, measurement writes and response.
- Preserve the exact existing canonical SHA-256 bytes: sorted object keys, original
  strings, array order, extra properties and JSON escaping. Old saved hashes must
  replay correctly after this change.
- Keep pure per-row validation and grouping, with rejection indexes referring to
  the original array. Invalid cached values must still reject every occurrence.
- Yield with `setImmediate` (not a resolved Promise, which would only yield to
  microtasks), using Node's portable timers API. Do not introduce worker processes.
- Cache successful ID/decimal normalization within one request only; no global
  validation cache or weakened bounds. Compare normalized positive decimal IDs by
  length then lexical order rather than repeatedly constructing BIGINTs during sort.
- A chunk size bounds rows processed between yields, not milliseconds: one unusually
  large field, JSON parsing, sorting, pg encoding/decoding, and classification can
  still block. Do not claim that all latency is fixed or validation is the sole cause.

## Implementation sequence

- [x] Add failing regression tests: an immediate callback runs before large-batch
      hashing/validation finishes; hash matches the legacy canonical encoder; indexes
      249/250/499/500/4999 remain correct; equivalent decimal/timestamp identities group
      across boundaries; numeric ID lock order holds above the JS safe integer limit.
- [x] Move canonical fingerprinting to `src/ingest/ingest.fingerprint.ts`; preserve
      the pure recursive encoding for individual values while streaming arrays to SHA-256
      in slices of 250. Await `setImmediate()` between array slices.
- [x] Add `src/ingest/ingest.processing.ts` with cooperative validation calling the
      shared pure validator with original index offsets and request-local normalization
      maps; yield between slices. Keep grouping pure and optimize its comparator.
- [x] Await fingerprinting in the admitted service and cooperative validation inside
      the repository's existing transaction. Leave SQL, schema and pool unchanged.
- [x] Run targeted regressions, `npm run check`, Prettier and diff checks serially.
- [x] Run fresh full-scale acceptance in an explicitly named local database, preserve
      all artifacts, compare against `75533ece-d3bd-4f16-8edf-396843e46261`, and document
      actual numbers plus any remaining target misses. Do not run builds/tests concurrently
      with acceptance; they can remove its compiled entry point.

No commit or push is authorized by this implementation step.

## Follow-up experiment: 100-point chunks

Approved scope: change only `processingChunkSize` in
`src/ingest/ingest.processing.ts` from 250 to 100. Both cooperative hashing and
validation consume that constant. More frequent `setImmediate` yields may help
latest reads during writes, but could reduce throughput. No guaranteed gain is
claimed; synchronous JSON parsing, grouping and driver processing remain.

Preserve the 5,000-point request limit, eight benchmark writers, pool size,
canonical hash bytes, validation bounds, SQL, indexes and one transaction per
batch. Do not introduce diagnostics, dependencies or workers. Keep the earlier
250-boundary regression tests and add 99/100/101-boundary cases.

- [x] Add regressions proving 101-point hashing and validation yield to I/O;
      both failed against 250 before changing the constant, then passed at 100.
- [x] Change the constant, update current README/validation documentation and
      run `npm run check` plus formatting checks serially. Typecheck, lint, build,
      84 unit tests and 24 integration/child-process tests passed (108 total).
- [x] User runs fresh acceptance and compares against
      `569d4d48-34e2-48c4-92f6-64c67987ddc4`: 47,089.26 points/sec,
      latest p95 118.30 ms, idle bucket p95 179.32 ms. Record the throughput/
      latency trade-off before deciding whether to retain 100-point chunks.

No commit/push or automatic full acceptance run is authorized for this experiment.

### Measured 100-point outcome

User-run acceptance `9b3a08d2-2b97-42d1-a8c1-2a86f01082ce`, reported at
`2026-10-07T19:16:07.608Z` (UTC), database `metrics_benchmark_chunk_100_01`.
Original local evidence is retained under
`artifacts/acceptance-9b3a08d2-2b97-42d1-a8c1-2a86f01082ce/REPORT.md`
and `acceptance.json`; this tracked summary does not require those ignored files.

| Measurement                         | Compact-result baseline, chunks 250 | Chunks 100 | Target                  |
| ----------------------------------- | ----------------------------------: | ---------: | ----------------------- |
| Fresh throughput (points/sec)       |                           47,089.26 |  45,419.21 | ≥20,000: pass           |
| Latest p95 during writes (ms)       |                              118.30 |      97.42 | ≤50: still fails        |
| 30-day hourly bucket p95, idle (ms) |                              179.32 |     183.45 | ≤150: still fails       |
| Write duration (seconds)            |                               42.47 |      44.03 | Informational           |
| API sampled peak RSS (MiB)          |                              232.76 |     242.87 | <512: pass              |
| Stored measurement rows             |                           2,000,000 |  2,000,000 | Exactly 2,000,000: pass |

Same machine: i3-7020U, four logical CPUs, 12,442,411,008 bytes RAM, Linux
6.8.0-51-generic, Node 20.18.0, PostgreSQL 17.11 in Docker, pool 12, JIT off.
Both runs used 5,000-point requests and eight writers, without extra latency
diagnostics. The only production change was processingChunkSize 250 to 100.

Observed latest p95 decreased approximately 17.7%, while throughput decreased
approximately 3.5%. All A–G correctness scenarios passed, including concurrent
deduplication, unchanged replay and SIGTERM restart recovery; no acceptance/load
errors were reported. Additional measurements: idle latest p95 5.70 ms, bucket
p95 during writes 427.70 ms, replay processed input 144,921.66 points/sec with
zero newly inserted rows (not fresh insertion throughput).

Decision: retain 100-point chunks for this observed read-latency/throughput
trade-off. One sequential comparison does not establish consistent improvement
or isolate cache/machine variation. Idle bucket SQL was unchanged; neither
latency target is met, so acceptance execution passed but performance compliance
failed. The user subsequently authorized recording this outcome and committing
the change; no push was requested.

### Cooperative processing repeat-run validation

Three completed runs used 2,000,000 points, 5,000-point batches, 8 writers,
a 12-connection pool and 100 idle samples per read endpoint.

| Measurement                          |   Before optimization | First cooperative run |     Cooperative rerun |
| ------------------------------------ | --------------------: | --------------------: | --------------------: |
| Latest p95 during writes             |             381.54 ms |             214.40 ms |             177.75 ms |
| Bucket p95, idle                     |             288.33 ms |             196.11 ms |             174.00 ms |
| Bucket p95 during writes             |             731.52 ms |             602.69 ms |             544.86 ms |
| Latest p95, idle                     |              14.45 ms |               6.88 ms |               5.38 ms |
| Fresh insertion throughput           |   34136.67 points/sec |   26289.45 points/sec |   30659.48 points/sec |
| Cold load wall time                  |               58.59 s |               76.08 s |               65.23 s |
| Replay wall time                     |               12.79 s |               20.07 s |               11.15 s |
| API peak sampled RSS                 |            241.99 MiB |            228.75 MiB |            242.34 MiB |
| Stored rows after cold load / replay | 2,000,000 / 2,000,000 | 2,000,000 / 2,000,000 | 2,000,000 / 2,000,000 |
| A–G correctness/recovery checks      |                  Pass |                  Pass |                  Pass |

Run identifiers, in column order:

- Before: `75533ece-d3bd-4f16-8edf-396843e46261`, `metrics_benchmark_diagnostic_01`, 2026-10-07T17:02:53.384Z.
- First cooperative run: `5c28e0eb-699b-4294-8d21-0d71e376ff8b`, `metrics_benchmark_cooperative_01`, 2026-10-07T17:32:28.970Z.
- Cooperative rerun: `f62a9552-6d44-4bbf-bc8c-7ef115704bb5`, `metrics_benchmark_cooperative_03`, 2026-10-07T17:42:23.789Z.

Latest p95 changed from **381.54 → 214.40 → 177.75 ms**.
The rerun is 53.41% below the pre-optimization
baseline and 17.09% below the first cooperative
run. Both cooperative runs improve on the baseline, but **neither meets latest
≤50 ms or bucket ≤150 ms**. Throughput, exact row count, unchanged replay and
sampled memory pass in each completed run.

No additional code change was made between the two cooperative runs. Their
difference is observed run-to-run variation, not a second optimization. Separate
fresh databases, sequential execution, variable cache/CPU conditions and different
numbers of reads serviced prevent isolating one change's impact from these numbers.

The `metrics_benchmark_cooperative_02` run was intentionally stopped before
completion when the user chose to run the command themselves. Its partial data
is retained and it is excluded from completed-run comparisons. No artifacts or
database rows were deleted.

### Cooperative processing comparison

Before: 75533ece-d3bd-4f16-8edf-396843e46261, database `metrics_benchmark_diagnostic_01`, 2026-10-07T17:02:53.384Z.
After: 5c28e0eb-699b-4294-8d21-0d71e376ff8b, database `metrics_benchmark_cooperative_01`, 2026-10-07T17:32:28.970Z.
Both used 2,000,000 points, 5,000-point requests, 8 writers, a 12-connection
API pool, JIT off, local Docker PostgreSQL and 100 idle samples per read endpoint.

| Measurement                                 |                Before |                 After |
| ------------------------------------------- | --------------------: | --------------------: |
| Latest HTTP p95 during writes               |             381.54 ms |             214.40 ms |
| Latest server-handler p95, cold-load window |             190.51 ms |             101.67 ms |
| Latest server-handler p50, cold-load window |              98.86 ms |              17.56 ms |
| Fresh HTTP write throughput                 |   34136.67 points/sec |   26289.45 points/sec |
| Cold load wall time                         |               58.59 s |               76.08 s |
| Replay wall time                            |               12.79 s |               20.07 s |
| Bucket HTTP p95, idle                       |             288.33 ms |             196.11 ms |
| Bucket HTTP p95 during writes               |             731.52 ms |             602.69 ms |
| Latest HTTP p95, idle                       |              14.45 ms |               6.88 ms |
| Peak sampled API RSS                        |            241.99 MiB |            228.75 MiB |
| Latest requests serviced during cold writes |                   165 |                   395 |
| Bucket requests serviced during cold writes |                    98 |                   192 |
| Stored rows after cold load / replay        | 2,000,000 / 2,000,000 | 2,000,000 / 2,000,000 |
| A–G execution/recovery checks               |                  Pass |                  Pass |

Latest end-to-end p95 decreased 43.81%.
Write throughput decreased 22.99%, but
remains above the 20,000 points/sec target. Both API latency targets still fail.

This is a before/after observation, not an isolated CPU-cost experiment. Readers
retain the same 100 ms pause but service more requests when latency falls, so the
after run also performs more read work. Sequential fresh databases, cache state
and machine scheduling add variation. Do not attribute the whole throughput
difference or the idle bucket change solely to yielding.

Server-handler metrics were calculated from existing `api-load.log` events:
select latest completions between the first fresh ingest's estimated handler start
and the 400th fresh ingest's completion, then use nearest-rank percentiles. This
gives 164 before and 394 after handler samples; it excludes the initial latest
request outside that window. The interceptor starts after request parsing/routing.
Its duration includes pool waiting, SQL round-trip time and callback scheduling,
not SQL execution alone. Client/server samples are not matched by request ID;
their percentiles must not be subtracted to invent a network/wait breakdown.

Verification: `npm run check` passed 74 unit tests and 23 real-database/child-process
tests (97 total), typecheck, lint and build. Yield regressions initially failed
on synchronous hashing/validation, then passed after the change. Golden legacy
hash bytes and chunk boundaries are tested; full acceptance retained exact
count/sum reconciliation, partial success, concurrent duplicates and SIGTERM recovery.

Next diagnosis: separately time pool acquisition, latest SQL round trips, event-loop
delay, remaining grouping/classification/pg processing, and load-client event-loop
delay. The measured improvement does not establish the cause of every remaining
millisecond. No schema, SQL, pool or dependency was changed.

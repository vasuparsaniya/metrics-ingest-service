# Cooperative measurement parameter encoding

Approved design: prepare the three measurement PostgreSQL array parameters in
100-point chunks before calling pg. Pass array text as bound parameters with the
existing bigint[], timestamptz[] and numeric[] SQL casts. Reuse the same encoded
parameters for mixed-batch classification. SQL and transaction boundaries stay
unchanged; there are no per-chunk queries, queues or additional dependencies.

## Evidence and invariants

Profile `api-06d0c132-8a20-4b46-bc17-46e923a48a5b.cpuprofile` sampled about
5.4% self time in pg array escaping, with inclusive array serialization about
6.4%. The entire API session includes startup/reconciliation and idle samples;
these percentages are not exact latest-request latency attribution.

Preserve one-dimensional string-array bytes, element order, negative/exact
decimals, microseconds and expanded/BC timestamps. Escape backslashes and double
quotes, quote every element (including a literal NULL string), and produce `{}`
for an empty array. An element with no escaping characters can avoid the two
replacement calls. Never interpolate array text into SQL. Validation is unchanged.
One unusually large element or final joining/driver byte encoding may still
block; this does not eliminate all event-loop or allocation costs.

## Steps

- [x] Add `src/ingest/ingest.parameters.ts` and unit tests with a synchronous
      reference first; prove an I/O callback test fails for 101 points.
- [x] Encode in 100-point chunks using setImmediate between chunks. Test empty,
      1/99/100/101/5000 points, quote/backslash/NULL escaping and input immutability.
- [x] Replace only measurement parameter preparation in the repository; use
      the same three strings for INSERT and fallback classification.
- [x] Verify array decoding and exact insertion on real PostgreSQL, plus existing
      5,000-point, concurrent, replay, partial-success and restart scenarios.
- [x] Run checks without profiling or a concurrent benchmark: 93 unit tests and
      26 integration/child-process tests passed (119 total), as did typecheck,
      lint and build. The I/O regression failed on the synchronous reference,
      then passed on the cooperative encoder.
- [x] User ran unprofiled acceptance in a fresh database. Compare against
      `9b3a08d2-2b97-42d1-a8c1-2a86f01082ce`: 45,419.21 points/sec,
      latest p95 97.42 ms. Results are recorded below.

## Full-scale result

Run `46e89655-f881-44ac-a331-83868e0fccd1`, UTC
`2026-10-08T01:22:01.911Z`, database `metrics_benchmark_cooperative_params_01`:
2,000,000 points, 5,000 points/request, eight writers, pool 12, JIT off.

- Fresh throughput: 46,781.87 points/sec versus 45,419.21 (+3.0%).
- Latest p95 during writes: 85.62 ms versus 97.42 (-12.1%); ≤50 ms target failed.
- Idle 30-day hourly bucket p95: 151.96 ms versus 183.45; ≤150 ms target failed.
- Write duration: 42.75 seconds; sampled API peak RSS: 247.03 MiB.
- Bucket p95 during writes: 429.97 ms; idle latest p95: 3.60 ms.
- Exact 2,000,000 rows, unchanged replay with zero new rows, all A–G correctness
  checks and POSIX SIGTERM recovery passed; no acceptance/load errors.

Retain this optimization, but verify consistency with repeated unprofiled runs.
Unchanged bucket SQL means its latency change cannot be directly attributed to
this encoder. Remaining latest latency may include other synchronous CPU work,
GC and database/client delays; another optional profile can guide investigation.
Profiling remains opt-in and its timings are diagnostic, not acceptance evidence.
The user subsequently requested recording these measurements and committing the
current changes; artifacts remain ignored and no push is requested.

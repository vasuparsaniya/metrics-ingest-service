# Measurement history

Recorded from retained local JSON evidence on 2026-10-07; no benchmarks rerun for this documentation update. PDF §3/§4 require machine, throughput, replay wall time, read latency, RSS and A–G evidence; §5 requires strategy/index costs and raw SQL plans; §6 requires reconciliation; §8 places submission results in the root README.

## Acceptance runs

| Run (UTC, 2026-10-07) | Run ID                               |  Points | Fresh points/s | Load s | Replay s | Latest write p95 ms | Bucket idle p95 ms | RSS MiB | Execution |
| --------------------- | ------------------------------------ | ------: | -------------: | -----: | -------: | ------------------: | -----------------: | ------: | --------- |
| 03:41:44              | a9005af0-bdc6-4b74-9407-cd41219df1bd |    5000 |       12177.74 |   0.41 |     0.06 |               68.09 |              24.00 |  102.89 | Pass      |
| 03:48:43              | e2219fe3-02c3-4eea-bff8-ccf9ea624577 |   40000 |       21974.85 |   1.82 |     0.36 |              476.25 |              30.83 |  141.38 | Pass      |
| 04:06:03              | 40557202-9dfc-449f-8491-c0d7f4efc67d |    5000 |        7210.45 |   0.69 |     0.20 |              188.02 |              46.31 |  103.68 | Fail      |
| 04:07:48              | 1625ae7b-aa2d-4a2b-9f28-eeebba4e065c |    5000 |           0.00 |   0.22 |     0.11 |               41.85 |              30.41 |   92.62 | Pass      |
| 04:45:33              | bf576835-8038-4896-81a6-234579022277 | 2000000 |       25572.91 |  78.21 |    26.89 |              536.37 |            1337.35 |  229.21 | Pass      |
| 05:16:38              | e366914a-00a0-41e1-aedc-0a874c47af1e | 2000000 |       28064.99 |  71.26 |    15.54 |              507.74 |            1176.10 |  228.18 | Pass      |
| 15:55:17              | 5d029224-683b-447f-b4e5-8b6a38730469 | 2000000 |       31396.47 |  63.70 |    13.34 |              455.94 |            1034.80 |  224.80 | Pass      |
| 16:06:19              | e97f84ec-7df1-4b87-87bd-bc261ca664c1 | 2000000 |       30631.27 |  65.29 |    15.11 |              470.79 |             399.52 |  234.36 | Fail      |
| 16:17:21              | 0cb69e6b-3c5c-44ab-8037-1708f197c435 |   40000 |       23456.87 |   1.71 |     0.33 |              528.42 |              30.01 |  137.24 | Pass      |
| 16:22:55              | 8971f065-fd23-4b64-a3bc-17a4b739c1a7 | 2000000 |       31172.38 |  64.16 |    15.11 |              479.64 |             210.68 |  227.09 | Pass      |

Execution Pass does not mean performance targets passed. Small datasets cannot establish full-scale compliance. The 1625ae7b run reused existing data (fresh throughput zero), not a clean cold load. The 40557202 failure was a missing compiled entry point during restart; the e97f84ec failure was the restart lock observer timing out. Later 8971f065 full-scale execution passed restart verification, but still failed both latency targets. Missing numbers are not inferred.

- 40557202-9dfc-449f-8491-c0d7f4efc67d: ENOENT: no such file or directory, access '/home/vasu-parsaniya/Documents/Interview/Qyne/Assigment/metrics-ingest-service/dist/main.js'
- e97f84ec-7df1-4b87-87bd-bc261ca664c1: Did not observe the target mid-batch lock before its timeout

## Full recorded acceptance summaries

<details>
<summary>bf576835-8038-4896-81a6-234579022277: 2000000 points</summary>

# Acceptance report

Acceptance execution: Pass. Performance: Fail.

The execution flag covers completed correctness checks, not all performance targets. This is an acceptance summary, not certification of every assignment deliverable.

Run: bf576835-8038-4896-81a6-234579022277. Measured at (UTC): 2026-10-07T04:45:33.725Z.
Database: Not recorded.
Points: 2000000; batch size: 5000; writers: 8; mode: cold.

## Performance targets

| Checkpoint                     |              Actual | Target             | Result |
| ------------------------------ | ------------------: | ------------------ | ------ |
| Stored rows                    |             2000000 | Exactly 2,000,000  | Pass   |
| Fresh insertion throughput     | 25572.91 points/sec | ≥20,000 points/sec | Pass   |
| Latest p95 during fresh writes |           536.37 ms | ≤50 ms             | Fail   |
| 30-day hourly bucket p95, idle |          1337.35 ms | ≤150 ms            | Fail   |
| API sampled peak RSS           |          229.21 MiB | <512 MiB           | Pass   |

## Additional measurements

- Write duration: 78.21 seconds.
- Bucket p95 during fresh writes: 2416.41 ms.
- Latest p95, idle: 6.64 ms.
- p95 degradation, latest / buckets: 7976.99% / 80.69%.
- Replay newly stored rows: 0; processed input: 74390.04 points/sec. Cached accepted responses are not new inserts.

## Scenarios A–G

| Scenario | Check                                            | Correctness/evidence |
| -------- | ------------------------------------------------ | -------------------- |
| A        | Exact counts/sums and bucket aggregates          | Pass                 |
| B        | Replay leaves counts and aggregates unchanged    | Pass                 |
| C        | Concurrent request/point deduplication           | Pass                 |
| D        | Partial success and indexed rejection accounting | Pass                 |
| E        | Late data changes buckets, not newest timestamp  | Pass                 |
| F        | Read latency measurements collected              | Pass                 |
| G        | Restart, rollback, resume and unchanged replay   | Pass                 |

Restart semantics: posix-sigterm; POSIX SIGTERM evidence: Pass.

## Machine

- cpu: Intel(R) Core(TM) i3-7020U CPU @ 2.30GHz.
- logicalCpus: 4.
- ramBytes: 12442415104.
- os: linux 6.8.0-51-generic.
- node: v20.18.0.
- postgres: PostgreSQL 17.11 (Debian 17.11-1.pgdg12+2) on x86\_64-pc-linux-gnu, compiled by gcc (Debian 12.2.0-14+deb12u1) 12.2.0, 64-bit.
- postgresInDocker: true.
- poolMax: 12.

## Errors and pending verification

Acceptance error: None.
Load errors: \[\].

- Unit/API integration suites and clean-clone reproducibility: Not measured by this report; verify separately.
- Failed performance targets require investigation and a new measurement after optimization. Do not treat replay throughput as fresh insertion throughput.

</details>

<details>
<summary>e366914a-00a0-41e1-aedc-0a874c47af1e: 2000000 points</summary>

# Acceptance report

Acceptance execution: Pass. Performance: Fail.

The execution flag covers completed correctness checks, not all performance targets. This is an acceptance summary, not certification of every assignment deliverable.

Run: e366914a-00a0-41e1-aedc-0a874c47af1e. Measured at (UTC): 2026-10-07T05:16:38.690Z.
Database: metrics\_benchmark\_final\_02.
Points: 2000000; batch size: 5000; writers: 8; mode: cold.

## Performance targets

| Checkpoint                     |              Actual | Target             | Result |
| ------------------------------ | ------------------: | ------------------ | ------ |
| Stored rows                    |             2000000 | Exactly 2,000,000  | Pass   |
| Fresh insertion throughput     | 28064.99 points/sec | ≥20,000 points/sec | Pass   |
| Latest p95 during fresh writes |           507.74 ms | ≤50 ms             | Fail   |
| 30-day hourly bucket p95, idle |          1176.10 ms | ≤150 ms            | Fail   |
| API sampled peak RSS           |          228.18 MiB | <512 MiB           | Pass   |

## Additional measurements

- Write duration: 71.26 seconds.
- Bucket p95 during fresh writes: 2027.73 ms.
- Latest p95, idle: 6.14 ms.
- p95 degradation, latest / buckets: 8175.53% / 72.41%.
- Replay newly stored rows: 0; processed input: 128700.26 points/sec. Cached accepted responses are not new inserts.

## Scenarios A–G

| Scenario | Check                                            | Correctness/evidence |
| -------- | ------------------------------------------------ | -------------------- |
| A        | Exact counts/sums and bucket aggregates          | Pass                 |
| B        | Replay leaves counts and aggregates unchanged    | Pass                 |
| C        | Concurrent request/point deduplication           | Pass                 |
| D        | Partial success and indexed rejection accounting | Pass                 |
| E        | Late data changes buckets, not newest timestamp  | Pass                 |
| F        | Read latency measurements collected              | Pass                 |
| G        | Restart, rollback, resume and unchanged replay   | Pass                 |

Restart semantics: posix-sigterm; POSIX SIGTERM evidence: Pass.

## Machine

- cpu: Intel(R) Core(TM) i3-7020U CPU @ 2.30GHz.
- logicalCpus: 4.
- ramBytes: 12442415104.
- os: linux 6.8.0-51-generic.
- node: v20.18.0.
- postgres: PostgreSQL 17.11 (Debian 17.11-1.pgdg12+2) on x86\_64-pc-linux-gnu, compiled by gcc (Debian 12.2.0-14+deb12u1) 12.2.0, 64-bit.
- postgresInDocker: true.
- poolMax: 12.

## Errors and pending verification

Acceptance error: None.
Load errors: \[\].

- Unit/API integration suites and clean-clone reproducibility: Not measured by this report; verify separately.
- Failed performance targets require investigation and a new measurement after optimization. Do not treat replay throughput as fresh insertion throughput.

</details>

<details>
<summary>5d029224-683b-447f-b4e5-8b6a38730469: 2000000 points</summary>

# Acceptance report

Acceptance execution: Pass. Performance: Fail.

The execution flag covers completed correctness checks, not all performance targets. This is an acceptance summary, not certification of every assignment deliverable.

Run: 5d029224-683b-447f-b4e5-8b6a38730469. Measured at (UTC): 2026-10-07T15:55:17.243Z.
Database: metrics\_benchmark\_final\_03.
Points: 2000000; batch size: 5000; writers: 8; mode: cold.

## Performance targets

| Checkpoint                     |              Actual | Target             | Result |
| ------------------------------ | ------------------: | ------------------ | ------ |
| Stored rows                    |             2000000 | Exactly 2,000,000  | Pass   |
| Fresh insertion throughput     | 31396.47 points/sec | ≥20,000 points/sec | Pass   |
| Latest p95 during fresh writes |           455.94 ms | ≤50 ms             | Fail   |
| 30-day hourly bucket p95, idle |          1034.80 ms | ≤150 ms            | Fail   |
| API sampled peak RSS           |          224.80 MiB | <512 MiB           | Pass   |

## Additional measurements

- Write duration: 63.70 seconds.
- Bucket p95 during fresh writes: 1011.56 ms.
- Latest p95, idle: 5.24 ms.
- p95 degradation, latest / buckets: 8609.07% / -2.25%.
- Replay newly stored rows: 0; processed input: 149955.90 points/sec. Cached accepted responses are not new inserts.

## Scenarios A–G

| Scenario | Check                                            | Correctness/evidence |
| -------- | ------------------------------------------------ | -------------------- |
| A        | Exact counts/sums and bucket aggregates          | Pass                 |
| B        | Replay leaves counts and aggregates unchanged    | Pass                 |
| C        | Concurrent request/point deduplication           | Pass                 |
| D        | Partial success and indexed rejection accounting | Pass                 |
| E        | Late data changes buckets, not newest timestamp  | Pass                 |
| F        | Read latency measurements collected              | Pass                 |
| G        | Restart, rollback, resume and unchanged replay   | Pass                 |

Restart semantics: posix-sigterm; POSIX SIGTERM evidence: Pass.

## Machine

- cpu: Intel(R) Core(TM) i3-7020U CPU @ 2.30GHz.
- logicalCpus: 4.
- ramBytes: 12442411008.
- os: linux 6.8.0-51-generic.
- node: v20.18.0.
- postgres: PostgreSQL 17.11 (Debian 17.11-1.pgdg12+2) on x86\_64-pc-linux-gnu, compiled by gcc (Debian 12.2.0-14+deb12u1) 12.2.0, 64-bit.
- postgresInDocker: true.
- poolMax: 12.

## Errors and pending verification

Acceptance error: None.
Load errors: \[\].

- Unit/API integration suites and clean-clone reproducibility: Not measured by this report; verify separately.
- Failed performance targets require investigation and a new measurement after optimization. Do not treat replay throughput as fresh insertion throughput.

</details>

<details>
<summary>e97f84ec-7df1-4b87-87bd-bc261ca664c1: 2000000 points</summary>

# Acceptance report

Acceptance execution: Fail. Performance: Fail.

The execution flag covers completed correctness checks, not all performance targets. This is an acceptance summary, not certification of every assignment deliverable.

Run: e97f84ec-7df1-4b87-87bd-bc261ca664c1. Measured at (UTC): 2026-10-07T16:06:19.016Z.
Database: metrics\_benchmark\_final\_04.
Points: 2000000; batch size: 5000; writers: 8; mode: cold.

## Performance targets

| Checkpoint                     |              Actual | Target             | Result |
| ------------------------------ | ------------------: | ------------------ | ------ |
| Stored rows                    |             2000000 | Exactly 2,000,000  | Pass   |
| Fresh insertion throughput     | 30631.27 points/sec | ≥20,000 points/sec | Pass   |
| Latest p95 during fresh writes |           470.79 ms | ≤50 ms             | Fail   |
| 30-day hourly bucket p95, idle |           399.52 ms | ≤150 ms            | Fail   |
| API sampled peak RSS           |          234.36 MiB | <512 MiB           | Pass   |

## Additional measurements

- Write duration: 65.29 seconds.
- Bucket p95 during fresh writes: 913.47 ms.
- Latest p95, idle: 9.95 ms.
- p95 degradation, latest / buckets: 4632.25% / 128.64%.
- Replay newly stored rows: 0; processed input: 132378.74 points/sec. Cached accepted responses are not new inserts.

## Scenarios A–G

| Scenario | Check                                            | Correctness/evidence |
| -------- | ------------------------------------------------ | -------------------- |
| A        | Exact counts/sums and bucket aggregates          | Pass                 |
| B        | Replay leaves counts and aggregates unchanged    | Pass                 |
| C        | Concurrent request/point deduplication           | Pass                 |
| D        | Partial success and indexed rejection accounting | Pass                 |
| E        | Late data changes buckets, not newest timestamp  | Pass                 |
| F        | Read latency measurements collected              | Pass                 |
| G        | Restart, rollback, resume and unchanged replay   | Not measured         |

Restart semantics: posix-sigterm; POSIX SIGTERM recovery verified: Not measured.

## Machine

- cpu: Intel(R) Core(TM) i3-7020U CPU @ 2.30GHz.
- logicalCpus: 4.
- ramBytes: 12442411008.
- os: linux 6.8.0-51-generic.
- node: v20.18.0.
- postgres: PostgreSQL 17.11 (Debian 17.11-1.pgdg12+2) on x86\_64-pc-linux-gnu, compiled by gcc (Debian 12.2.0-14+deb12u1) 12.2.0, 64-bit.
- postgresJit: off.
- postgresInDocker: true.
- poolMax: 12.

## Errors and pending verification

Acceptance error: Did not observe the target mid-batch lock before its timeout.
Load errors: \[\].

- Unit/API integration suites and clean-clone reproducibility: Not measured by this report; verify separately.
- Failed performance targets require investigation and a new measurement after optimization. Do not treat replay throughput as fresh insertion throughput.

</details>

<details>
<summary>0cb69e6b-3c5c-44ab-8037-1708f197c435: 40000 points</summary>

# Acceptance report

Acceptance execution: Pass. Performance: Not measured.

The execution flag covers completed correctness checks, not all performance targets. This is an acceptance summary, not certification of every assignment deliverable.

Run: 0cb69e6b-3c5c-44ab-8037-1708f197c435. Measured at (UTC): 2026-10-07T16:17:21.851Z.
Database: metrics\_benchmark\_restart\_fix\_20261007.
Points: 40000; batch size: 5000; writers: 8; mode: cold.

This run is not a fresh two-million-point load; its measurements do not establish full-scale performance compliance.

## Performance targets

| Checkpoint                     |              Actual | Target             | Result       |
| ------------------------------ | ------------------: | ------------------ | ------------ |
| Stored rows                    |               40000 | Exactly 2,000,000  | Not measured |
| Fresh insertion throughput     | 23456.87 points/sec | ≥20,000 points/sec | Not measured |
| Latest p95 during fresh writes |           528.42 ms | ≤50 ms             | Not measured |
| 30-day hourly bucket p95, idle |            30.01 ms | ≤150 ms            | Not measured |
| API sampled peak RSS           |          137.24 MiB | <512 MiB           | Not measured |

## Additional measurements

- Write duration: 1.71 seconds.
- Bucket p95 during fresh writes: 1070.13 ms.
- Latest p95, idle: 4.45 ms.
- p95 degradation, latest / buckets: 11762.67% / 3466.17%.
- Replay newly stored rows: 0; processed input: 120637.08 points/sec. Cached accepted responses are not new inserts.

## Scenarios A–G

| Scenario | Check                                            | Correctness/evidence |
| -------- | ------------------------------------------------ | -------------------- |
| A        | Exact counts/sums and bucket aggregates          | Pass                 |
| B        | Replay leaves counts and aggregates unchanged    | Pass                 |
| C        | Concurrent request/point deduplication           | Pass                 |
| D        | Partial success and indexed rejection accounting | Pass                 |
| E        | Late data changes buckets, not newest timestamp  | Pass                 |
| F        | Read latency measurements collected              | Pass                 |
| G        | Restart, rollback, resume and unchanged replay   | Pass                 |

Restart semantics: posix-sigterm; POSIX SIGTERM recovery verified: Pass.

## Machine

- cpu: Intel(R) Core(TM) i3-7020U CPU @ 2.30GHz.
- logicalCpus: 4.
- ramBytes: 12442411008.
- os: linux 6.8.0-51-generic.
- node: v20.18.0.
- postgres: PostgreSQL 17.11 (Debian 17.11-1.pgdg12+2) on x86\_64-pc-linux-gnu, compiled by gcc (Debian 12.2.0-14+deb12u1) 12.2.0, 64-bit.
- postgresJit: off.
- postgresInDocker: true.
- poolMax: 12.

## Errors and pending verification

Acceptance error: None.
Load errors: \[\].

- Unit/API integration suites and clean-clone reproducibility: Not measured by this report; verify separately.
- Failed performance targets require investigation and a new measurement after optimization. Do not treat replay throughput as fresh insertion throughput.

</details>

<details>
<summary>8971f065-fd23-4b64-a3bc-17a4b739c1a7: 2000000 points</summary>

# Acceptance report

Acceptance execution: Pass. Performance: Fail.

The execution flag covers completed correctness checks, not all performance targets. This is an acceptance summary, not certification of every assignment deliverable.

Run: 8971f065-fd23-4b64-a3bc-17a4b739c1a7. Measured at (UTC): 2026-10-07T16:22:55.382Z.
Database: metrics\_benchmark\_final\_05.
Points: 2000000; batch size: 5000; writers: 8; mode: cold.

## Performance targets

| Checkpoint                     |              Actual | Target             | Result |
| ------------------------------ | ------------------: | ------------------ | ------ |
| Stored rows                    |             2000000 | Exactly 2,000,000  | Pass   |
| Fresh insertion throughput     | 31172.38 points/sec | ≥20,000 points/sec | Pass   |
| Latest p95 during fresh writes |           479.64 ms | ≤50 ms             | Fail   |
| 30-day hourly bucket p95, idle |           210.68 ms | ≤150 ms            | Fail   |
| API sampled peak RSS           |          227.09 MiB | <512 MiB           | Pass   |

## Additional measurements

- Write duration: 64.16 seconds.
- Bucket p95 during fresh writes: 888.44 ms.
- Latest p95, idle: 5.34 ms.
- p95 degradation, latest / buckets: 8890.50% / 321.69%.
- Replay newly stored rows: 0; processed input: 132385.19 points/sec. Cached accepted responses are not new inserts.

## Scenarios A–G

| Scenario | Check                                            | Correctness/evidence |
| -------- | ------------------------------------------------ | -------------------- |
| A        | Exact counts/sums and bucket aggregates          | Pass                 |
| B        | Replay leaves counts and aggregates unchanged    | Pass                 |
| C        | Concurrent request/point deduplication           | Pass                 |
| D        | Partial success and indexed rejection accounting | Pass                 |
| E        | Late data changes buckets, not newest timestamp  | Pass                 |
| F        | Read latency measurements collected              | Pass                 |
| G        | Restart, rollback, resume and unchanged replay   | Pass                 |

Restart semantics: posix-sigterm; POSIX SIGTERM recovery verified: Pass.

## Machine

- cpu: Intel(R) Core(TM) i3-7020U CPU @ 2.30GHz.
- logicalCpus: 4.
- ramBytes: 12442411008.
- os: linux 6.8.0-51-generic.
- node: v20.18.0.
- postgres: PostgreSQL 17.11 (Debian 17.11-1.pgdg12+2) on x86\_64-pc-linux-gnu, compiled by gcc (Debian 12.2.0-14+deb12u1) 12.2.0, 64-bit.
- postgresJit: off.
- postgresInDocker: true.
- poolMax: 12.

## Errors and pending verification

Acceptance error: None.
Load errors: \[\].

- Unit/API integration suites and clean-clone reproducibility: Not measured by this report; verify separately.
- Failed performance targets require investigation and a new measurement after optimization. Do not treat replay throughput as fresh insertion throughput.

</details>

## SQL comparison evidence

# SQL strategy and index comparison

Execution: Completed. Full assignment scale: Yes.

Dataset run: ee1a8da8-4de7-45ac-acec-2e9de6412f7c. Measured at (UTC): 2026-10-07T05:26:01.172Z.
Database: Not recorded.
Points: 2000000; batch size: Not recorded; writers: Not recorded; comparison pool: Not recorded.

## Insert strategies and reconciliation

| Experiment              |    Rows | Duration |          Throughput | Exact reconciliation                   |
| ----------------------- | ------: | -------: | ------------------: | -------------------------------------- |
| unnestPrimaryOnly       | 2000000 |  34.91 s | 57289.25 points/sec | per-series count and exact sum matched |
| valuesPrimaryOnly       | 2000000 |  41.56 s | 48123.71 points/sec | per-series count and exact sum matched |
| unnestWithCoveringIndex | 2000000 |  46.35 s | 43146.76 points/sec | per-series count and exact sum matched |

These are insert-kernel microbenchmarks, not an end-to-end API throughput claim. They exclude HTTP validation, request hashing, idempotency records and post-insert classification.

## Optional covering-index cost

- Throughput change versus primary-only UNNEST: -24.69%. Negative means slower writes.
- Write-duration change for the same dataset: 32.78%. Positive means longer writes.
- Bucket SQL p95 change: -15.84%. Negative means faster reads.

## SQL query timings

| Experiment        | Samples |   Minimum |       p50 |        p95 |    Maximum |
| ----------------- | ------: | --------: | --------: | ---------: | ---------: |
| primaryOnly       |      20 | 798.69 ms | 850.47 ms | 1216.89 ms | 1318.82 ms |
| withCoveringIndex |      20 | 713.25 ms | 837.58 ms | 1024.17 ms | 1047.50 ms |

These are direct SQL timings, not HTTP latency results. They do not prove the ≤150 ms bucket or ≤50 ms latest API targets, nor latest latency under concurrent API writes.

## Relation storage

| Relation                             | Recorded bytes |        MiB |
| ------------------------------------ | -------------: | ---------: |
| bench\_8c0ffb09c49b4d8d\_base        |      104415232 |  99.58 MiB |
| bench\_8c0ffb09c49b4d8d\_base\_pkey  |       67731456 |  64.59 MiB |
| bench\_8c0ffb09c49b4d8d\_cover       |      104448000 |  99.61 MiB |
| bench\_8c0ffb09c49b4d8d\_cover\_idx  |      142368768 | 135.77 MiB |
| bench\_8c0ffb09c49b4d8d\_cover\_pkey |       68894720 |  65.70 MiB |

Sizes are pg_relation_size values for the listed heap/index relations, not total database usage (TOAST/WAL and unlisted relations are not included).

## EXPLAIN (ANALYZE, BUFFERS) evidence

### production

Measured EXPLAIN wall time: 1904.33 ms.

    Nested Loop Left Join  (cost=76277.17..2785476.93 rows=595404 width=264) (actual time=1664.354..1687.595 rows=720 loops=1)
      Buffers: shared hit=2874 read=2984 written=2033
      ->  Merge Left Join  (cost=76276.71..84307.12 rows=595404 width=144) (actual time=1663.530..1664.514 rows=720 loops=1)
            Merge Cond: ((('2026-09-01 00:00:00+00'::timestamp with time zone + ((steps.step)::double precision * '01:00:00'::interval))) = a.bucket)
            Buffers: shared read=2978 written=2028
            ->  Sort  (cost=41.39..43.19 rows=720 width=8) (actual time=642.227..642.371 rows=720 loops=1)
                  Sort Key: (('2026-09-01 00:00:00+00'::timestamp with time zone + ((steps.step)::double precision * '01:00:00'::interval)))
                  Sort Method: quicksort  Memory: 47kB
                  ->  Function Scan on generate_series steps  (cost=0.02..7.22 rows=720 width=8) (actual time=641.989..642.122 rows=720 loops=1)
            ->  Sort  (cost=76235.32..76648.80 rows=165390 width=144) (actual time=1021.265..1021.418 rows=720 loops=1)
                  Sort Key: a.bucket
                  Sort Method: quicksort  Memory: 72kB
                  Buffers: shared read=2978 written=2028
                  ->  Subquery Scan on a  (cost=43024.26..50027.72 rows=165390 width=144) (actual time=1018.954..1020.648 rows=720 loops=1)
                        Buffers: shared read=2978 written=2028
                        ->  HashAggregate  (cost=43024.26..48373.82 rows=165390 width=144) (actual time=1018.945..1020.461 rows=720 loops=1)
                              Group Key: date_trunc('hour'::text, measurements.ts, 'UTC'::text)
                              Planned Partitions: 16  Batches: 1  Memory Usage: 913kB
                              Buffers: shared read=2978 written=2028
                              ->  Bitmap Heap Scan on measurements  (cost=7257.98..25032.30 rows=251416 width=14) (actual time=188.469..789.021 rows=250000 loops=1)
                                    Recheck Cond: ((series_id = '1'::bigint) AND (ts >= '2026-09-01 00:00:00+00'::timestamp with time zone) AND (ts < '2026-10-01 00:00:00+00'::timestamp with time zone))
                                    Heap Blocks: exact=1979
                                    Buffers: shared read=2978 written=2028
                                    ->  Bitmap Index Scan on measurements_pkey  (cost=0.00..7195.13 rows=251416 width=0) (actual time=186.974..186.974 rows=250000 loops=1)
                                          Index Cond: ((series_id = '1'::bigint) AND (ts >= '2026-09-01 00:00:00+00'::timestamp with time zone) AND (ts < '2026-10-01 00:00:00+00'::timestamp with time zone))
                                          Buffers: shared read=999 written=464
      ->  Limit  (cost=0.46..4.28 rows=1 width=14) (actual time=0.022..0.022 rows=1 loops=720)
            Buffers: shared hit=2874 read=6 written=5
            ->  Result  (cost=0.46..4798.06 rows=1257 width=14) (actual time=0.022..0.022 rows=1 loops=720)
                  One-Time Filter: (a.count > 0)
                  Buffers: shared hit=2874 read=6 written=5
                  ->  Index Scan Backward using measurements_pkey on measurements measurements_1  (cost=0.46..4798.06 rows=1257 width=14) (actual time=0.020..0.020 rows=1 loops=720)
                        Index Cond: ((series_id = '1'::bigint) AND (ts >= GREATEST(('2026-09-01 00:00:00+00'::timestamp with time zone + ((steps.step)::double precision * '01:00:00'::interval)), '2026-09-01 00:00:00+00'::timestamp with time zone)) AND (ts < CASE WHEN (('2026-09-01 00:00:00+00'::timestamp with time zone + ((steps.step)::double precision * '01:00:00'::interval)) = date_trunc('hour'::text, ('2026-10-01 00:00:00+00'::timestamp with time zone - '00:00:00.000001'::interval), 'UTC'::text)) THEN '2026-10-01 00:00:00+00'::timestamp with time zone ELSE (('2026-09-01 00:00:00+00'::timestamp with time zone + ((steps.step)::double precision * '01:00:00'::interval)) + '01:00:00'::interval) END))
                        Buffers: shared hit=2874 read=6 written=5
    Planning:
      Buffers: shared hit=48 read=3
    Planning Time: 1.792 ms
    JIT:
      Functions: 29
      Options: Inlining true, Optimization true, Expressions true, Deforming true
      Timing: Generation 3.573 ms (Deform 0.472 ms), Inlining 141.958 ms, Optimization 276.919 ms, Emission 223.174 ms, Total 645.624 ms
    Execution Time: 1891.626 ms

### primaryOnly

Measured EXPLAIN wall time: 1070.80 ms.

    Nested Loop Left Join  (cost=77477.06..2792485.57 rows=597380 width=264) (actual time=1048.005..1064.032 rows=720 loops=1)
      Buffers: shared hit=2901 read=3009 written=2200
      ->  Merge Left Join  (cost=77476.60..85533.63 rows=597380 width=144) (actual time=1047.934..1048.608 rows=720 loops=1)
            Merge Cond: ((('2026-09-01 00:00:00+00'::timestamp with time zone + ((steps.step)::double precision * '01:00:00'::interval))) = a.bucket)
            Buffers: shared hit=26 read=3004 written=2197
            ->  Sort  (cost=41.39..43.19 rows=720 width=8) (actual time=527.131..527.242 rows=720 loops=1)
                  Sort Key: (('2026-09-01 00:00:00+00'::timestamp with time zone + ((steps.step)::double precision * '01:00:00'::interval)))
                  Sort Method: quicksort  Memory: 47kB
                  ->  Function Scan on generate_series steps  (cost=0.02..7.22 rows=720 width=8) (actual time=526.891..527.024 rows=720 loops=1)
            ->  Sort  (cost=77435.21..77850.05 rows=165939 width=144) (actual time=520.782..520.896 rows=720 loops=1)
                  Sort Key: a.bucket
                  Sort Method: quicksort  Memory: 72kB
                  Buffers: shared hit=26 read=3004 written=2197
                  ->  Subquery Scan on a  (cost=44041.94..51134.05 rows=165939 width=144) (actual time=519.741..520.488 rows=720 loops=1)
                        Buffers: shared hit=26 read=3004 written=2197
                        ->  HashAggregate  (cost=44041.94..49474.66 rows=165939 width=144) (actual time=519.737..520.401 rows=720 loops=1)
                              Group Key: date_trunc('hour'::text, bench_8c0ffb09c49b4d8d_base.ts, 'UTC'::text)
                              Planned Partitions: 16  Batches: 1  Memory Usage: 913kB
                              Buffers: shared hit=26 read=3004 written=2197
                              ->  Bitmap Heap Scan on bench_8c0ffb09c49b4d8d_base  (cost=7586.01..25510.97 rows=258948 width=14) (actual time=136.073..399.248 rows=250000 loops=1)
                                    Recheck Cond: ((series_id = '1'::bigint) AND (ts >= '2026-09-01 00:00:00+00'::timestamp with time zone) AND (ts < '2026-10-01 00:00:00+00'::timestamp with time zone))
                                    Heap Blocks: exact=2013
                                    Buffers: shared hit=26 read=3004 written=2197
                                    ->  Bitmap Index Scan on bench_8c0ffb09c49b4d8d_base_pkey  (cost=0.00..7521.28 rows=258948 width=0) (actual time=135.363..135.364 rows=250000 loops=1)
                                          Index Cond: ((series_id = '1'::bigint) AND (ts >= '2026-09-01 00:00:00+00'::timestamp with time zone) AND (ts < '2026-10-01 00:00:00+00'::timestamp with time zone))
                                          Buffers: shared read=1017 written=629
      ->  Limit  (cost=0.46..4.27 rows=1 width=14) (actual time=0.016..0.016 rows=1 loops=720)
            Buffers: shared hit=2875 read=5 written=3
            ->  Result  (cost=0.46..4936.19 rows=1295 width=14) (actual time=0.015..0.015 rows=1 loops=720)
                  One-Time Filter: (a.count > 0)
                  Buffers: shared hit=2875 read=5 written=3
                  ->  Index Scan Backward using bench_8c0ffb09c49b4d8d_base_pkey on bench_8c0ffb09c49b4d8d_base bench_8c0ffb09c49b4d8d_base_1  (cost=0.46..4936.19 rows=1295 width=14) (actual time=0.014..0.014 rows=1 loops=720)
                        Index Cond: ((series_id = '1'::bigint) AND (ts >= GREATEST(('2026-09-01 00:00:00+00'::timestamp with time zone + ((steps.step)::double precision * '01:00:00'::interval)), '2026-09-01 00:00:00+00'::timestamp with time zone)) AND (ts < CASE WHEN (('2026-09-01 00:00:00+00'::timestamp with time zone + ((steps.step)::double precision * '01:00:00'::interval)) = date_trunc('hour'::text, ('2026-10-01 00:00:00+00'::timestamp with time zone - '00:00:00.000001'::interval), 'UTC'::text)) THEN '2026-10-01 00:00:00+00'::timestamp with time zone ELSE (('2026-09-01 00:00:00+00'::timestamp with time zone + ((steps.step)::double precision * '01:00:00'::interval)) + '01:00:00'::interval) END))
                        Buffers: shared hit=2875 read=5 written=3
    Planning:
      Buffers: shared hit=15 read=1
    Planning Time: 0.808 ms
    JIT:
      Functions: 29
      Options: Inlining true, Optimization true, Expressions true, Deforming true
      Timing: Generation 4.138 ms (Deform 0.534 ms), Inlining 33.598 ms, Optimization 245.598 ms, Emission 247.703 ms, Total 531.036 ms
    Execution Time: 1068.475 ms

### withCoveringIndex

Measured EXPLAIN wall time: 941.96 ms.

    Nested Loop Left Join  (cost=76256.06..1745355.60 rows=590893 width=264) (actual time=865.252..935.756 rows=720 loops=1)
      Buffers: shared hit=2868 read=2754 written=1493
      ->  Merge Left Join  (cost=76255.60..84225.24 rows=590893 width=144) (actual time=862.792..863.825 rows=720 loops=1)
            Merge Cond: ((('2026-09-01 00:00:00+00'::timestamp with time zone + ((steps.step)::double precision * '01:00:00'::interval))) = a.bucket)
            Buffers: shared hit=1006 read=2064 written=1120
            ->  Sort  (cost=41.39..43.19 rows=720 width=8) (actual time=530.171..530.328 rows=720 loops=1)
                  Sort Key: (('2026-09-01 00:00:00+00'::timestamp with time zone + ((steps.step)::double precision * '01:00:00'::interval)))
                  Sort Method: quicksort  Memory: 47kB
                  ->  Function Scan on generate_series steps  (cost=0.02..7.22 rows=720 width=8) (actual time=529.745..529.966 rows=720 loops=1)
            ->  Sort  (cost=76214.21..76624.55 rows=164137 width=144) (actual time=332.598..332.757 rows=720 loops=1)
                  Sort Key: a.bucket
                  Sort Method: quicksort  Memory: 72kB
                  Buffers: shared hit=1006 read=2064 written=1120
                  ->  Subquery Scan on a  (cost=43240.11..50211.72 rows=164137 width=144) (actual time=331.561..332.313 rows=720 loops=1)
                        Buffers: shared hit=1006 read=2064 written=1120
                        ->  HashAggregate  (cost=43240.11..48570.35 rows=164137 width=144) (actual time=331.557..332.226 rows=720 loops=1)
                              Group Key: date_trunc('hour'::text, bench_8c0ffb09c49b4d8d_cover.ts, 'UTC'::text)
                              Planned Partitions: 16  Batches: 1  Memory Usage: 913kB
                              Buffers: shared hit=1006 read=2064 written=1120
                              ->  Bitmap Heap Scan on bench_8c0ffb09c49b4d8d_cover  (cost=7445.39..25229.05 rows=251683 width=14) (actual time=63.891..245.318 rows=250000 loops=1)
                                    Recheck Cond: ((series_id = '1'::bigint) AND (ts >= '2026-09-01 00:00:00+00'::timestamp with time zone) AND (ts < '2026-10-01 00:00:00+00'::timestamp with time zone))
                                    Heap Blocks: exact=2031
                                    Buffers: shared hit=1006 read=2064 written=1120
                                    ->  Bitmap Index Scan on bench_8c0ffb09c49b4d8d_cover_pkey  (cost=0.00..7382.47 rows=251683 width=0) (actual time=63.449..63.449 rows=250000 loops=1)
                                          Index Cond: ((series_id = '1'::bigint) AND (ts >= '2026-09-01 00:00:00+00'::timestamp with time zone) AND (ts < '2026-10-01 00:00:00+00'::timestamp with time zone))
                                          Buffers: shared hit=320 read=719 written=196
      ->  Limit  (cost=0.46..2.55 rows=1 width=14) (actual time=0.092..0.092 rows=1 loops=720)
            Buffers: shared hit=1862 read=690 written=373
            ->  Result  (cost=0.46..2633.31 rows=1259 width=14) (actual time=0.092..0.092 rows=1 loops=720)
                  One-Time Filter: (a.count > 0)
                  Buffers: shared hit=1862 read=690 written=373
                  ->  Index Only Scan using bench_8c0ffb09c49b4d8d_cover_idx on bench_8c0ffb09c49b4d8d_cover bench_8c0ffb09c49b4d8d_cover_1  (cost=0.46..2633.31 rows=1259 width=14) (actual time=0.089..0.089 rows=1 loops=720)
                        Index Cond: ((series_id = '1'::bigint) AND (ts >= GREATEST(('2026-09-01 00:00:00+00'::timestamp with time zone + ((steps.step)::double precision * '01:00:00'::interval)), '2026-09-01 00:00:00+00'::timestamp with time zone)) AND (ts < CASE WHEN (('2026-09-01 00:00:00+00'::timestamp with time zone + ((steps.step)::double precision * '01:00:00'::interval)) = date_trunc('hour'::text, ('2026-10-01 00:00:00+00'::timestamp with time zone - '00:00:00.000001'::interval), 'UTC'::text)) THEN '2026-10-01 00:00:00+00'::timestamp with time zone ELSE (('2026-09-01 00:00:00+00'::timestamp with time zone + ((steps.step)::double precision * '01:00:00'::interval)) + '01:00:00'::interval) END))
                        Heap Fetches: 387
                        Buffers: shared hit=1862 read=690 written=373
    Planning:
      Buffers: shared hit=29 read=2 written=2
    Planning Time: 0.895 ms
    JIT:
      Functions: 27
      Options: Inlining true, Optimization true, Expressions true, Deforming true
      Timing: Generation 3.330 ms (Deform 0.500 ms), Inlining 33.857 ms, Optimization 283.872 ms, Emission 211.930 ms, Total 532.989 ms
    Execution Time: 939.484 ms

### indexesDisabled

Measured EXPLAIN wall time: 30001.25 ms.

Failure: canceling statement due to statement timeout. No successful execution plan is claimed.

Note: 30-second timeout is a measured failure; no EXPLAIN output is fabricated..

Plan output: Not measured.

### series

Measured EXPLAIN wall time: 0.96 ms.

    Index Only Scan using series_pkey on series  (cost=0.14..8.16 rows=1 width=8) (actual time=0.036..0.037 rows=1 loops=1)
      Index Cond: (id = '1'::bigint)
      Heap Fetches: 1
      Buffers: shared hit=2
    Planning Time: 0.065 ms
    Execution Time: 0.049 ms

### latest

Measured EXPLAIN wall time: 0.64 ms.

    Limit  (cost=0.43..0.66 rows=1 width=14) (actual time=0.016..0.017 rows=1 loops=1)
      Buffers: shared hit=4
      ->  Index Scan Backward using measurements_pkey on measurements  (cost=0.43..58954.79 rows=251467 width=14) (actual time=0.015..0.015 rows=1 loops=1)
            Index Cond: (series_id = '1'::bigint)
            Buffers: shared hit=4
    Planning Time: 0.063 ms
    Execution Time: 0.028 ms

### requestReplay

Measured EXPLAIN wall time: 2.84 ms.

    Index Scan using ingest_requests_pkey on ingest_requests  (cost=0.27..8.29 rows=1 width=108) (actual time=0.430..0.431 rows=1 loops=1)
      Index Cond: ((idempotency_key)::text = 'load:ee1a8da8-4de7-45ac-acec-2e9de6412f7c:0'::text)
      Buffers: shared read=3
    Planning:
      Buffers: shared hit=65 read=6
    Planning Time: 1.135 ms
    Execution Time: 0.443 ms

## Machine

- cpu: Intel(R) Core(TM) i3-7020U CPU @ 2.30GHz.
- logicalCpus: 4.
- ramBytes: 12442415104.
- os: linux 6.8.0-51-generic.
- node: v20.18.0.
- postgres: PostgreSQL 17.11 (Debian 17.11-1.pgdg12+2) on x86\_64-pc-linux-gnu, compiled by gcc (Debian 12.2.0-14+deb12u1) 12.2.0, 64-bit.
- postgresInDocker: true.

## Methodology, limitations and conclusions

Methodology: Insert-kernel microbenchmark, 8 writers/5000 points per transaction, identical constraints and generated data. It excludes HTTP validation, hashing, idempotency-table writes, and post-insert classification; not an end-to-end throughput claim. Runs are sequential and cache/order noise must be considered. Tables are retained..

Index experiment: PK stays in place. Covering-index write cost is measured with/without that optional index. Planner disabling demonstrates a no-index-read plan, not an actual dropped correctness constraint. No production index is changed; an index or rewrite is adopted only after reviewing measured full-scale evidence..

Error: None recorded.

Sequential trials are sensitive to cache/order noise. A timed-out index-disabled query is failed evidence, not a fabricated plan. Primary-key constraints stay intact; no production index was changed. This comparison alone does not justify adopting an index or certify a production improvement. Review the write/read trade-off and rerun API benchmarks after any adopted change.

Retained experimental tables:

- bench\_8c0ffb09c49b4d8d\_base.
- bench\_8c0ffb09c49b4d8d\_values.
- bench\_8c0ffb09c49b4d8d\_cover.

## Original evidence

Original local source: `comparison-1791350566416-edbef258-34b5-4854-a8a0-f0f1d15db163.json` in ignored artifacts. The measured results and raw plans are embedded above; reading this document does not require that file. Rerunning a comparison requires a manifest generated by a new load, not a previous local artifact.

Generated after measurements, without accessing the database. Missing evidence remains Not measured.

## Rewrite diagnostic

Same existing two-million-point database; JIT off; no fresh writes. All eight series' before/after responses matched and independent aggregates passed. SQL execution samples are not HTTP p95.

| Pair | Before ms | After ms |
| ---- | --------: | -------: |
| 1    |   489.369 |  170.817 |
| 2    |   361.223 |  194.626 |
| 3    |   363.211 |  174.719 |

### Raw EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON): first before/after pair

<details>
<summary>beforeRewrite, 489.369 ms</summary>

```json
{
  "Plan": {
    "Node Type": "Nested Loop",
    "Parallel Aware": false,
    "Async Capable": false,
    "Join Type": "Left",
    "Startup Cost": 76277.17,
    "Total Cost": 2785476.93,
    "Plan Rows": 595404,
    "Plan Width": 264,
    "Actual Startup Time": 467.748,
    "Actual Total Time": 488.321,
    "Actual Rows": 720,
    "Actual Loops": 1,
    "Inner Unique": false,
    "Shared Hit Blocks": 5857,
    "Shared Read Blocks": 1,
    "Shared Dirtied Blocks": 0,
    "Shared Written Blocks": 0,
    "Local Hit Blocks": 0,
    "Local Read Blocks": 0,
    "Local Dirtied Blocks": 0,
    "Local Written Blocks": 0,
    "Temp Read Blocks": 0,
    "Temp Written Blocks": 0,
    "Plans": [
      {
        "Node Type": "Merge Join",
        "Parent Relationship": "Outer",
        "Parallel Aware": false,
        "Async Capable": false,
        "Join Type": "Left",
        "Startup Cost": 76276.71,
        "Total Cost": 84307.12,
        "Plan Rows": 595404,
        "Plan Width": 144,
        "Actual Startup Time": 467.578,
        "Actual Total Time": 468.567,
        "Actual Rows": 720,
        "Actual Loops": 1,
        "Inner Unique": true,
        "Merge Cond": "((('2026-09-01 00:00:00+00'::timestamp with time zone + ((steps.step)::double precision * '01:00:00'::interval))) = a.bucket)",
        "Shared Hit Blocks": 2977,
        "Shared Read Blocks": 1,
        "Shared Dirtied Blocks": 0,
        "Shared Written Blocks": 0,
        "Local Hit Blocks": 0,
        "Local Read Blocks": 0,
        "Local Dirtied Blocks": 0,
        "Local Written Blocks": 0,
        "Temp Read Blocks": 0,
        "Temp Written Blocks": 0,
        "Plans": [
          {
            "Node Type": "Sort",
            "Parent Relationship": "Outer",
            "Parallel Aware": false,
            "Async Capable": false,
            "Startup Cost": 41.39,
            "Total Cost": 43.19,
            "Plan Rows": 720,
            "Plan Width": 8,
            "Actual Startup Time": 0.754,
            "Actual Total Time": 0.885,
            "Actual Rows": 720,
            "Actual Loops": 1,
            "Sort Key": [
              "(('2026-09-01 00:00:00+00'::timestamp with time zone + ((steps.step)::double precision * '01:00:00'::interval)))"
            ],
            "Sort Method": "quicksort",
            "Sort Space Used": 47,
            "Sort Space Type": "Memory",
            "Shared Hit Blocks": 0,
            "Shared Read Blocks": 0,
            "Shared Dirtied Blocks": 0,
            "Shared Written Blocks": 0,
            "Local Hit Blocks": 0,
            "Local Read Blocks": 0,
            "Local Dirtied Blocks": 0,
            "Local Written Blocks": 0,
            "Temp Read Blocks": 0,
            "Temp Written Blocks": 0,
            "Plans": [
              {
                "Node Type": "Function Scan",
                "Parent Relationship": "Outer",
                "Parallel Aware": false,
                "Async Capable": false,
                "Function Name": "generate_series",
                "Alias": "steps",
                "Startup Cost": 0.02,
                "Total Cost": 7.22,
                "Plan Rows": 720,
                "Plan Width": 8,
                "Actual Startup Time": 0.191,
                "Actual Total Time": 0.489,
                "Actual Rows": 720,
                "Actual Loops": 1,
                "Shared Hit Blocks": 0,
                "Shared Read Blocks": 0,
                "Shared Dirtied Blocks": 0,
                "Shared Written Blocks": 0,
                "Local Hit Blocks": 0,
                "Local Read Blocks": 0,
                "Local Dirtied Blocks": 0,
                "Local Written Blocks": 0,
                "Temp Read Blocks": 0,
                "Temp Written Blocks": 0
              }
            ]
          },
          {
            "Node Type": "Sort",
            "Parent Relationship": "Inner",
            "Parallel Aware": false,
            "Async Capable": false,
            "Startup Cost": 76235.32,
            "Total Cost": 76648.8,
            "Plan Rows": 165390,
            "Plan Width": 144,
            "Actual Startup Time": 466.818,
            "Actual Total Time": 466.96,
            "Actual Rows": 720,
            "Actual Loops": 1,
            "Sort Key": ["a.bucket"],
            "Sort Method": "quicksort",
            "Sort Space Used": 72,
            "Sort Space Type": "Memory",
            "Shared Hit Blocks": 2977,
            "Shared Read Blocks": 1,
            "Shared Dirtied Blocks": 0,
            "Shared Written Blocks": 0,
            "Local Hit Blocks": 0,
            "Local Read Blocks": 0,
            "Local Dirtied Blocks": 0,
            "Local Written Blocks": 0,
            "Temp Read Blocks": 0,
            "Temp Written Blocks": 0,
            "Plans": [
              {
                "Node Type": "Subquery Scan",
                "Parent Relationship": "Outer",
                "Parallel Aware": false,
                "Async Capable": false,
                "Alias": "a",
                "Startup Cost": 43024.26,
                "Total Cost": 50027.72,
                "Plan Rows": 165390,
                "Plan Width": 144,
                "Actual Startup Time": 465.54,
                "Actual Total Time": 466.435,
                "Actual Rows": 720,
                "Actual Loops": 1,
                "Shared Hit Blocks": 2977,
                "Shared Read Blocks": 1,
                "Shared Dirtied Blocks": 0,
                "Shared Written Blocks": 0,
                "Local Hit Blocks": 0,
                "Local Read Blocks": 0,
                "Local Dirtied Blocks": 0,
                "Local Written Blocks": 0,
                "Temp Read Blocks": 0,
                "Temp Written Blocks": 0,
                "Plans": [
                  {
                    "Node Type": "Aggregate",
                    "Strategy": "Hashed",
                    "Partial Mode": "Simple",
                    "Parent Relationship": "Subquery",
                    "Parallel Aware": false,
                    "Async Capable": false,
                    "Startup Cost": 43024.26,
                    "Total Cost": 48373.82,
                    "Plan Rows": 165390,
                    "Plan Width": 144,
                    "Actual Startup Time": 465.539,
                    "Actual Total Time": 466.317,
                    "Actual Rows": 720,
                    "Actual Loops": 1,
                    "Group Key": [
                      "date_trunc('hour'::text, measurements.ts, 'UTC'::text)"
                    ],
                    "Planned Partitions": 16,
                    "HashAgg Batches": 1,
                    "Peak Memory Usage": 913,
                    "Disk Usage": 0,
                    "Shared Hit Blocks": 2977,
                    "Shared Read Blocks": 1,
                    "Shared Dirtied Blocks": 0,
                    "Shared Written Blocks": 0,
                    "Local Hit Blocks": 0,
                    "Local Read Blocks": 0,
                    "Local Dirtied Blocks": 0,
                    "Local Written Blocks": 0,
                    "Temp Read Blocks": 0,
                    "Temp Written Blocks": 0,
                    "Plans": [
                      {
                        "Node Type": "Bitmap Heap Scan",
                        "Parent Relationship": "Outer",
                        "Parallel Aware": false,
                        "Async Capable": false,
                        "Relation Name": "measurements",
                        "Alias": "measurements",
                        "Startup Cost": 7257.98,
                        "Total Cost": 25032.3,
                        "Plan Rows": 251416,
                        "Plan Width": 14,
                        "Actual Startup Time": 35.652,
                        "Actual Total Time": 313.068,
                        "Actual Rows": 250000,
                        "Actual Loops": 1,
                        "Recheck Cond": "((series_id = '1'::bigint) AND (ts >= '2026-09-01 00:00:00+00'::timestamp with time zone) AND (ts < '2026-10-01 00:00:00+00'::timestamp with time zone))",
                        "Rows Removed by Index Recheck": 0,
                        "Exact Heap Blocks": 1979,
                        "Lossy Heap Blocks": 0,
                        "Shared Hit Blocks": 2977,
                        "Shared Read Blocks": 1,
                        "Shared Dirtied Blocks": 0,
                        "Shared Written Blocks": 0,
                        "Local Hit Blocks": 0,
                        "Local Read Blocks": 0,
                        "Local Dirtied Blocks": 0,
                        "Local Written Blocks": 0,
                        "Temp Read Blocks": 0,
                        "Temp Written Blocks": 0,
                        "Plans": [
                          {
                            "Node Type": "Bitmap Index Scan",
                            "Parent Relationship": "Outer",
                            "Parallel Aware": false,
                            "Async Capable": false,
                            "Index Name": "measurements_pkey",
                            "Startup Cost": 0,
                            "Total Cost": 7195.13,
                            "Plan Rows": 251416,
                            "Plan Width": 0,
                            "Actual Startup Time": 35.098,
                            "Actual Total Time": 35.098,
                            "Actual Rows": 250000,
                            "Actual Loops": 1,
                            "Index Cond": "((series_id = '1'::bigint) AND (ts >= '2026-09-01 00:00:00+00'::timestamp with time zone) AND (ts < '2026-10-01 00:00:00+00'::timestamp with time zone))",
                            "Shared Hit Blocks": 999,
                            "Shared Read Blocks": 0,
                            "Shared Dirtied Blocks": 0,
                            "Shared Written Blocks": 0,
                            "Local Hit Blocks": 0,
                            "Local Read Blocks": 0,
                            "Local Dirtied Blocks": 0,
                            "Local Written Blocks": 0,
                            "Temp Read Blocks": 0,
                            "Temp Written Blocks": 0
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        "Node Type": "Limit",
        "Parent Relationship": "Inner",
        "Parallel Aware": false,
        "Async Capable": false,
        "Startup Cost": 0.46,
        "Total Cost": 4.28,
        "Plan Rows": 1,
        "Plan Width": 14,
        "Actual Startup Time": 0.019,
        "Actual Total Time": 0.019,
        "Actual Rows": 1,
        "Actual Loops": 720,
        "Shared Hit Blocks": 2880,
        "Shared Read Blocks": 0,
        "Shared Dirtied Blocks": 0,
        "Shared Written Blocks": 0,
        "Local Hit Blocks": 0,
        "Local Read Blocks": 0,
        "Local Dirtied Blocks": 0,
        "Local Written Blocks": 0,
        "Temp Read Blocks": 0,
        "Temp Written Blocks": 0,
        "Plans": [
          {
            "Node Type": "Result",
            "Parent Relationship": "Outer",
            "Parallel Aware": false,
            "Async Capable": false,
            "Startup Cost": 0.46,
            "Total Cost": 4798.06,
            "Plan Rows": 1257,
            "Plan Width": 14,
            "Actual Startup Time": 0.018,
            "Actual Total Time": 0.018,
            "Actual Rows": 1,
            "Actual Loops": 720,
            "One-Time Filter": "(a.count > 0)",
            "Shared Hit Blocks": 2880,
            "Shared Read Blocks": 0,
            "Shared Dirtied Blocks": 0,
            "Shared Written Blocks": 0,
            "Local Hit Blocks": 0,
            "Local Read Blocks": 0,
            "Local Dirtied Blocks": 0,
            "Local Written Blocks": 0,
            "Temp Read Blocks": 0,
            "Temp Written Blocks": 0,
            "Plans": [
              {
                "Node Type": "Index Scan",
                "Parent Relationship": "Outer",
                "Parallel Aware": false,
                "Async Capable": false,
                "Scan Direction": "Backward",
                "Index Name": "measurements_pkey",
                "Relation Name": "measurements",
                "Alias": "measurements_1",
                "Startup Cost": 0.46,
                "Total Cost": 4798.06,
                "Plan Rows": 1257,
                "Plan Width": 14,
                "Actual Startup Time": 0.016,
                "Actual Total Time": 0.016,
                "Actual Rows": 1,
                "Actual Loops": 720,
                "Index Cond": "((series_id = '1'::bigint) AND (ts >= GREATEST(('2026-09-01 00:00:00+00'::timestamp with time zone + ((steps.step)::double precision * '01:00:00'::interval)), '2026-09-01 00:00:00+00'::timestamp with time zone)) AND (ts < CASE WHEN (('2026-09-01 00:00:00+00'::timestamp with time zone + ((steps.step)::double precision * '01:00:00'::interval)) = date_trunc('hour'::text, ('2026-10-01 00:00:00+00'::timestamp with time zone - '00:00:00.000001'::interval), 'UTC'::text)) THEN '2026-10-01 00:00:00+00'::timestamp with time zone ELSE (('2026-09-01 00:00:00+00'::timestamp with time zone + ((steps.step)::double precision * '01:00:00'::interval)) + '01:00:00'::interval) END))",
                "Rows Removed by Index Recheck": 0,
                "Shared Hit Blocks": 2880,
                "Shared Read Blocks": 0,
                "Shared Dirtied Blocks": 0,
                "Shared Written Blocks": 0,
                "Local Hit Blocks": 0,
                "Local Read Blocks": 0,
                "Local Dirtied Blocks": 0,
                "Local Written Blocks": 0,
                "Temp Read Blocks": 0,
                "Temp Written Blocks": 0
              }
            ]
          }
        ]
      }
    ]
  },
  "Planning": {
    "Shared Hit Blocks": 175,
    "Shared Read Blocks": 26,
    "Shared Dirtied Blocks": 0,
    "Shared Written Blocks": 0,
    "Local Hit Blocks": 0,
    "Local Read Blocks": 0,
    "Local Dirtied Blocks": 0,
    "Local Written Blocks": 0,
    "Temp Read Blocks": 0,
    "Temp Written Blocks": 0
  },
  "Planning Time": 3.242,
  "Triggers": [],
  "Execution Time": 489.369
}
```

</details>

<details>
<summary>afterRewrite, 170.817 ms</summary>

```json
{
  "Plan": {
    "Node Type": "Sort",
    "Parallel Aware": false,
    "Async Capable": false,
    "Startup Cost": 2745165.72,
    "Total Cost": 2745167.52,
    "Plan Rows": 720,
    "Plan Width": 264,
    "Actual Startup Time": 170.483,
    "Actual Total Time": 170.557,
    "Actual Rows": 720,
    "Actual Loops": 1,
    "Sort Key": [
      "(('2026-09-01 00:00:00+00'::timestamp with time zone + ((steps.step)::double precision * '01:00:00'::interval)))"
    ],
    "Sort Method": "quicksort",
    "Sort Space Used": 118,
    "Sort Space Type": "Memory",
    "Shared Hit Blocks": 8637,
    "Shared Read Blocks": 0,
    "Shared Dirtied Blocks": 0,
    "Shared Written Blocks": 0,
    "Local Hit Blocks": 0,
    "Local Read Blocks": 0,
    "Local Dirtied Blocks": 0,
    "Local Written Blocks": 0,
    "Temp Read Blocks": 0,
    "Temp Written Blocks": 0,
    "Plans": [
      {
        "Node Type": "Nested Loop",
        "Parent Relationship": "Outer",
        "Parallel Aware": false,
        "Async Capable": false,
        "Join Type": "Left",
        "Startup Cost": 3812.81,
        "Total Cost": 2745131.55,
        "Plan Rows": 720,
        "Plan Width": 264,
        "Actual Startup Time": 0.495,
        "Actual Total Time": 169.818,
        "Actual Rows": 720,
        "Actual Loops": 1,
        "Inner Unique": true,
        "Shared Hit Blocks": 8637,
        "Shared Read Blocks": 0,
        "Shared Dirtied Blocks": 0,
        "Shared Written Blocks": 0,
        "Local Hit Blocks": 0,
        "Local Read Blocks": 0,
        "Local Dirtied Blocks": 0,
        "Local Written Blocks": 0,
        "Temp Read Blocks": 0,
        "Temp Written Blocks": 0,
        "Plans": [
          {
            "Node Type": "Nested Loop",
            "Parent Relationship": "Outer",
            "Parallel Aware": false,
            "Async Capable": false,
            "Join Type": "Inner",
            "Startup Cost": 3812.37,
            "Total Cost": 2744918.47,
            "Plan Rows": 720,
            "Plan Width": 152,
            "Actual Startup Time": 0.451,
            "Actual Total Time": 158.255,
            "Actual Rows": 720,
            "Actual Loops": 1,
            "Inner Unique": false,
            "Shared Hit Blocks": 5757,
            "Shared Read Blocks": 0,
            "Shared Dirtied Blocks": 0,
            "Shared Written Blocks": 0,
            "Local Hit Blocks": 0,
            "Local Read Blocks": 0,
            "Local Dirtied Blocks": 0,
            "Local Written Blocks": 0,
            "Temp Read Blocks": 0,
            "Temp Written Blocks": 0,
            "Plans": [
              {
                "Node Type": "Function Scan",
                "Parent Relationship": "Outer",
                "Parallel Aware": false,
                "Async Capable": false,
                "Function Name": "generate_series",
                "Alias": "steps",
                "Startup Cost": 0.02,
                "Total Cost": 7.22,
                "Plan Rows": 720,
                "Plan Width": 8,
                "Actual Startup Time": 0.116,
                "Actual Total Time": 0.305,
                "Actual Rows": 720,
                "Actual Loops": 1,
                "Shared Hit Blocks": 0,
                "Shared Read Blocks": 0,
                "Shared Dirtied Blocks": 0,
                "Shared Written Blocks": 0,
                "Local Hit Blocks": 0,
                "Local Read Blocks": 0,
                "Local Dirtied Blocks": 0,
                "Local Written Blocks": 0,
                "Temp Read Blocks": 0,
                "Temp Written Blocks": 0
              },
              {
                "Node Type": "Aggregate",
                "Strategy": "Plain",
                "Partial Mode": "Simple",
                "Parent Relationship": "Inner",
                "Parallel Aware": false,
                "Async Capable": false,
                "Startup Cost": 3812.36,
                "Total Cost": 3812.37,
                "Plan Rows": 1,
                "Plan Width": 144,
                "Actual Startup Time": 0.218,
                "Actual Total Time": 0.218,
                "Actual Rows": 1,
                "Actual Loops": 720,
                "Shared Hit Blocks": 5757,
                "Shared Read Blocks": 0,
                "Shared Dirtied Blocks": 0,
                "Shared Written Blocks": 0,
                "Local Hit Blocks": 0,
                "Local Read Blocks": 0,
                "Local Dirtied Blocks": 0,
                "Local Written Blocks": 0,
                "Temp Read Blocks": 0,
                "Temp Written Blocks": 0,
                "Plans": [
                  {
                    "Node Type": "Bitmap Heap Scan",
                    "Parent Relationship": "Outer",
                    "Parallel Aware": false,
                    "Async Capable": false,
                    "Relation Name": "measurements",
                    "Alias": "measurements",
                    "Startup Cost": 40.49,
                    "Total Cost": 3796.64,
                    "Plan Rows": 1257,
                    "Plan Width": 14,
                    "Actual Startup Time": 0.043,
                    "Actual Total Time": 0.09,
                    "Actual Rows": 347,
                    "Actual Loops": 720,
                    "Recheck Cond": "((series_id = '1'::bigint) AND (ts >= GREATEST(('2026-09-01 00:00:00+00'::timestamp with time zone + ((steps.step)::double precision * '01:00:00'::interval)), '2026-09-01 00:00:00+00'::timestamp with time zone)) AND (ts < CASE WHEN (('2026-09-01 00:00:00+00'::timestamp with time zone + ((steps.step)::double precision * '01:00:00'::interval)) = date_trunc('hour'::text, ('2026-10-01 00:00:00+00'::timestamp with time zone - '00:00:00.000001'::interval), 'UTC'::text)) THEN '2026-10-01 00:00:00+00'::timestamp with time zone ELSE (('2026-09-01 00:00:00+00'::timestamp with time zone + ((steps.step)::double precision * '01:00:00'::interval)) + '01:00:00'::interval) END))",
                    "Rows Removed by Index Recheck": 0,
                    "Exact Heap Blocks": 2614,
                    "Lossy Heap Blocks": 0,
                    "Shared Hit Blocks": 5757,
                    "Shared Read Blocks": 0,
                    "Shared Dirtied Blocks": 0,
                    "Shared Written Blocks": 0,
                    "Local Hit Blocks": 0,
                    "Local Read Blocks": 0,
                    "Local Dirtied Blocks": 0,
                    "Local Written Blocks": 0,
                    "Temp Read Blocks": 0,
                    "Temp Written Blocks": 0,
                    "Plans": [
                      {
                        "Node Type": "Bitmap Index Scan",
                        "Parent Relationship": "Outer",
                        "Parallel Aware": false,
                        "Async Capable": false,
                        "Index Name": "measurements_pkey",
                        "Startup Cost": 0,
                        "Total Cost": 40.18,
                        "Plan Rows": 1257,
                        "Plan Width": 0,
                        "Actual Startup Time": 0.035,
                        "Actual Total Time": 0.035,
                        "Actual Rows": 347,
                        "Actual Loops": 720,
                        "Index Cond": "((series_id = '1'::bigint) AND (ts >= GREATEST(('2026-09-01 00:00:00+00'::timestamp with time zone + ((steps.step)::double precision * '01:00:00'::interval)), '2026-09-01 00:00:00+00'::timestamp with time zone)) AND (ts < CASE WHEN (('2026-09-01 00:00:00+00'::timestamp with time zone + ((steps.step)::double precision * '01:00:00'::interval)) = date_trunc('hour'::text, ('2026-10-01 00:00:00+00'::timestamp with time zone - '00:00:00.000001'::interval), 'UTC'::text)) THEN '2026-10-01 00:00:00+00'::timestamp with time zone ELSE (('2026-09-01 00:00:00+00'::timestamp with time zone + ((steps.step)::double precision * '01:00:00'::interval)) + '01:00:00'::interval) END))",
                        "Shared Hit Blocks": 3143,
                        "Shared Read Blocks": 0,
                        "Shared Dirtied Blocks": 0,
                        "Shared Written Blocks": 0,
                        "Local Hit Blocks": 0,
                        "Local Read Blocks": 0,
                        "Local Dirtied Blocks": 0,
                        "Local Written Blocks": 0,
                        "Temp Read Blocks": 0,
                        "Temp Written Blocks": 0
                      }
                    ]
                  }
                ]
              }
            ]
          },
          {
            "Node Type": "Memoize",
            "Parent Relationship": "Inner",
            "Parallel Aware": false,
            "Async Capable": false,
            "Startup Cost": 0.44,
            "Total Cost": 8.46,
            "Plan Rows": 1,
            "Plan Width": 14,
            "Actual Startup Time": 0.007,
            "Actual Total Time": 0.007,
            "Actual Rows": 1,
            "Actual Loops": 720,
            "Cache Key": "(max(measurements.ts))",
            "Cache Mode": "logical",
            "Cache Hits": 0,
            "Cache Misses": 720,
            "Cache Evictions": 0,
            "Cache Overflows": 0,
            "Peak Memory Usage": 85,
            "Shared Hit Blocks": 2880,
            "Shared Read Blocks": 0,
            "Shared Dirtied Blocks": 0,
            "Shared Written Blocks": 0,
            "Local Hit Blocks": 0,
            "Local Read Blocks": 0,
            "Local Dirtied Blocks": 0,
            "Local Written Blocks": 0,
            "Temp Read Blocks": 0,
            "Temp Written Blocks": 0,
            "Plans": [
              {
                "Node Type": "Index Scan",
                "Parent Relationship": "Outer",
                "Parallel Aware": false,
                "Async Capable": false,
                "Scan Direction": "Forward",
                "Index Name": "measurements_pkey",
                "Relation Name": "measurements",
                "Alias": "last_point",
                "Startup Cost": 0.43,
                "Total Cost": 8.45,
                "Plan Rows": 1,
                "Plan Width": 14,
                "Actual Startup Time": 0.005,
                "Actual Total Time": 0.005,
                "Actual Rows": 1,
                "Actual Loops": 720,
                "Index Cond": "((series_id = '1'::bigint) AND (ts = (max(measurements.ts))))",
                "Rows Removed by Index Recheck": 0,
                "Shared Hit Blocks": 2880,
                "Shared Read Blocks": 0,
                "Shared Dirtied Blocks": 0,
                "Shared Written Blocks": 0,
                "Local Hit Blocks": 0,
                "Local Read Blocks": 0,
                "Local Dirtied Blocks": 0,
                "Local Written Blocks": 0,
                "Temp Read Blocks": 0,
                "Temp Written Blocks": 0
              }
            ]
          }
        ]
      }
    ]
  },
  "Planning": {
    "Shared Hit Blocks": 5,
    "Shared Read Blocks": 0,
    "Shared Dirtied Blocks": 0,
    "Shared Written Blocks": 0,
    "Local Hit Blocks": 0,
    "Local Read Blocks": 0,
    "Local Dirtied Blocks": 0,
    "Local Written Blocks": 0,
    "Temp Read Blocks": 0,
    "Temp Written Blocks": 0
  },
  "Planning Time": 0.909,
  "Triggers": [],
  "Execution Time": 170.817
}
```

</details>

# Metrics Ingest Service

A backend service for ingesting timestamped measurements in batches and querying exact time-bucketed aggregates. Built for the QYNE Insights Backend Engineer assignment.

## Technology stack

- Node.js
- NestJS 11
- TypeScript with strict mode
- PostgreSQL, running locally through Docker Compose
- `pg` (node-postgres) for direct SQL queries, transactions, and connection pooling
- Jest and Supertest for unit and API tests, including tests against real PostgreSQL
- ESLint and Prettier

## Project status

All required API routes and business-schema migrations are implemented. Full two-million-point acceptance runs, SQL strategy/index experiments, and query optimization measurements are recorded below. The latest representative run for the retained implementation completed A–G correctness/recovery checks and passed throughput, row-count and memory targets, but failed both latency targets. This is not a claim of full assignment compliance.

Work is on `feat/ingest`; the submission must include an open pull request into `main`.

## Current target achievement

**3 of 5 measured targets achieved.** These values describe the retained
implementation, not the best result selected from experimental runs.

| Checkpoint                     | Assignment target  |             Achieved | Result |
| ------------------------------ | ------------------ | -------------------: | ------ |
| Stored rows                    | Exactly 2,000,000  |            2,000,000 | Pass   |
| Fresh insertion throughput     | ≥20,000 points/sec | 50,570.24 points/sec | Pass   |
| Latest p95 during fresh writes | ≤50 ms             |             78.92 ms | Fail   |
| 30-day hourly bucket p95, idle | ≤150 ms            |            166.48 ms | Fail   |
| API sampled peak RSS           | <512 MB            |           239.03 MiB | Pass   |

Source: full-scale unprofiled acceptance run
`25b93ce8-9e25-4d77-9cef-88bc0c989cf2`, UTC `2026-10-08T02:53:20.681Z`, database
`metrics_benchmark_without_hash_fast_path_01`. Workload: 2,000,000 points,
5,000-point requests, eight writers, pool 12, JIT off. This cold run preceded
adding the experimental covering index to that database. Timestamp and parameter
encoding optimizations were enabled; hashing fast path and cooperative grouping
are not retained. All A–G correctness/recovery checks passed, replay added zero
rows and no errors were reported. The report uses a 512 MiB memory threshold;
observed RSS also meets the assignment's stricter 512 MB threshold.

Update this table and its source run together after a new full-scale, unprofiled
acceptance measurement of adopted changes. Preserve previous results in the
measurement history below. Do not replace values with replay throughput,
profiling results, post-maintenance timings or unadopted experiments. This table
is maintained in README; generating an artifact report does not update it
automatically. Full assignment compliance includes evidence beyond these five
targets and is not established by correctness success alone.

## Local setup

Prerequisites: Node.js 20 or newer, npm, Docker, and Docker Compose. `.nvmrc` records the local Node.js version used during setup. The package lock fixes installed dependency versions.

```bash
npm ci
cp .env.example .env
npm run db:up
npm run db:migrate
npm run start:dev
```

PostgreSQL runs in Docker using `docker-compose.yml` on host port `5433`; the application runs on the host at `http://localhost:3000`. Database files persist in a Docker volume. The initial container setup also creates `metrics_test` for integration tests. Initialization scripts only run on a new database volume.

The example credentials and token are for local development. `.env` is ignored by Git. If you change `POSTGRES_PORT` or credentials, update both database URLs to match. `PORT` controls the HTTP port.

## Authentication and health

All endpoints, including probes, require the configured static bearer token. This is our current interpretation of the assignment's authentication requirement. Manual curl examples below use Bash syntax; the npm verification/load commands are the shell-independent way to exercise the service.

```bash
curl -H 'Authorization: Bearer local-development-token' http://localhost:3000/healthz
curl -H 'Authorization: Bearer local-development-token' http://localhost:3000/readyz
```

`/healthz` returns 200 while the application is alive, independently of PostgreSQL. `/readyz` executes `SELECT 1` and returns 503 when the database is unavailable. Missing or invalid tokens return 401.

## Migrations

```bash
npm run db:migrate
```

The runner creates `series`, `measurements`, and `ingest_requests` through numbered SQL files and records checksums in `schema_migrations`. Repeating the command skips unchanged applied files; editing an applied file is rejected. Use `npm run db:migrate:test` for the isolated test database. All pending migrations and tracking entries commit atomically under an advisory lock.

## API contracts

| Method | Route                                             | Result                                                                                       |
| ------ | ------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| POST   | `/v1/series`                                      | Create a series from `{ "name": "temperature" }`; returns `{ "seriesId": "1" }` with 201     |
| POST   | `/v1/ingest`                                      | Accept `{ "points": [...] }`; returns accepted, duplicates, and indexed rejections with 200  |
| GET    | `/v1/series/:id/points?from=...&to=...&bucket=1h` | Array of UTC-aligned bucket summaries                                                        |
| GET    | `/v1/series/:id/latest`                           | Newest point by timestamp, JSON null for an empty known series, or 404 for an unknown series |
| GET    | `/v1/stats`                                       | Exact totals and per-series counts and timestamp coverage                                    |
| GET    | `/healthz`                                        | Application liveness                                                                         |
| GET    | `/readyz`                                         | Database readiness                                                                           |

### Create and ingest

```bash
curl -X POST http://localhost:3000/v1/series \
  -H 'Authorization: Bearer local-development-token' \
  -H 'Content-Type: application/json' \
  -d '{"name":"temperature"}'

# Replace seriesId with the ID returned above.
curl -X POST http://localhost:3000/v1/ingest \
  -H 'Authorization: Bearer local-development-token' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: example-batch-001' \
  -d '{"points":[{"seriesId":"1","ts":"2026-10-07T10:15:00.123456Z","value":"-10.75"}]}'
```

Series IDs are positive BIGINT decimal strings. Names are trimmed, non-empty, at most 200 Unicode characters, and need not be unique. Values are finite plain decimal strings: optional minus sign, integer digits, and optional fractional digits. Scientific notation and JSON-number values are rejected. Validation uses PostgreSQL's native NUMERIC limits, not an arbitrary application precision cap; no value is rounded or converted through JavaScript Number.

Timestamps use ISO 8601 with an explicit `Z` or `±HH:MM` offset and at most six fractional digits. Calendar dates and native storage bounds are validated. Expanded signed years are supported; no application-only 0001–9999 restriction is imposed. Leap seconds and `24:00` are rejected. SQL output preserves microseconds in UTC.

A point is identified by `(seriesId, ts)`. Equal-value repetitions are duplicates; different values for an existing point are rejected without overwriting. Within a batch, the first valid occurrence establishes the candidate, later equal occurrences are duplicates, and later different occurrences are rejected. If the candidate conflicts with existing data, its equal repetitions are rejected too. Invalid rows do not prevent valid rows committing.

### Request replay

Require exactly one Idempotency-Key: 1–128 printable ASCII characters excluding spaces/control characters. Missing or invalid keys return 400. Same key and canonical body returns the original saved response; changed content returns 409. Canonicalization ignores object-property order and whitespace but preserves array order and original string contents. Thus `"1"` and `"1.0"` are different request bodies, although they are numerically equal for point deduplication.

The key, inserted points, and saved JSONB response commit in one transaction. Records do not expire automatically. Returning the original `accepted` count on replay confirms the original operation; it does not indicate another insertion. Concurrent claims coordinate through PostgreSQL's unique constraint, with a two-second lock timeout.

### Bucket queries and stats

```bash
curl -G http://localhost:3000/v1/series/1/points \
  -H 'Authorization: Bearer local-development-token' \
  --data-urlencode 'from=2026-10-07T10:00:00Z' \
  --data-urlencode 'to=2026-10-07T12:00:00Z' \
  --data-urlencode 'bucket=1h'
```

The range is `from <= ts < to`. Buckets `1m`, `1h`, and `1d` align to UTC minute/hour/day boundaries. Each object contains `bucketStart`, count, sum, min, max, avg, and last. Filter the requested range before aggregation, including partial boundary buckets. Last is `{ ts, value }` selected by measurement time. Empty buckets are emitted with count zero and all aggregate values null.

Decimal results are strings. PostgreSQL calculates all aggregates. AVG uses PostgreSQL NUMERIC division with no further application rounding; repeating averages have finite decimal precision, an explicit interpretation of the brief's exactness requirement. Exact sum and count are also returned. Counts use JSON integers while safe and decimal strings above JavaScript's safe-integer range. Invalid ranges/buckets return 400; unknown series return 404. No arbitrary bucket-count cap is imposed; database statement timeouts still apply.

Stats returns `totalSeries`, `totalMeasurements`, and `series: [{ seriesId, name, count, from, to }]` from one snapshot. Empty series have zero count and null coverage endpoints. Coverage does not assert that there are no gaps.

### Load protection and failures

Batches above 5000 points return 413. A 16 MiB transport-body ceiling bounds parser allocation independently of numeric precision. Ingest admission reserves four connections from the configured pool; with the default pool of 12 this permits eight active ingests and rejects excess with 429 and `Retry-After: 1`, rather than creating an application queue. Small pool configurations permit at least one ingest, but cannot guarantee the same reader headroom.

Lock contention and statement timeouts return retryable 429; database connectivity failures return 503. Results exceeding native numeric/timestamp bounds return 422. Pool size and timeouts are initial operational settings, not benchmark-backed conclusions. Structured logs include request IDs, batch keys, counts, durations, and outcomes, without row payloads or batch bodies.

Design details: [database](docs/database-design.md), [row validation](docs/ingest-validation.md), [request idempotency](docs/request-idempotency.md), [queries](docs/query-design.md), and [stats](docs/stats-design.md).

## Checks and tests

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run test:e2e
npm run build
```

`npm run check` combines typecheck, lint, unit tests, end-to-end tests, and build. Start PostgreSQL first and set TEST_DATABASE_URL to the separate test database. API tests apply migrations automatically and remove only their own data. Tests cover request replay/mismatch, concurrent duplicate and conflicting batches, 5000-point partial failure, out-of-order arrival, microsecond identity, bucket boundaries/nulls, stats, and overload. The restart test launches real Node processes, SIGTERMs one while it is blocked mid-batch, checks rollback, and retries after restart. It does not yet reproduce a two-million-point interrupted load.

Pure numeric, timestamp, grouping, hashing, and configuration tests run without database mocks. End-to-end tests start the application themselves; no separately running NestJS process is needed.

Use `npm run format` to format files. After building, `npm start` runs the compiled application. Ctrl+C or POSIX SIGTERM closes the HTTP server and connection pool through NestJS shutdown hooks. Native Windows process termination is not the same as POSIX graceful shutdown; see the platform notes below.

The initial pool limit is 12, with bounded connection and statement timeouts. Its final size and behavior under full load must be measured before claiming it meets assignment targets.

## Run all seven APIs locally

Start the service with the local setup commands above. In another terminal, run this smoke check (Node.js parses the created series ID, so jq is not required). Use your configured token if different from the example. This creates one series and one point, not the assignment's full load.

```bash
export METRICS_BASE_URL=http://localhost:3000
export METRICS_TOKEN=local-development-token

curl --fail-with-body "$METRICS_BASE_URL/healthz" -H "Authorization: Bearer $METRICS_TOKEN"
curl --fail-with-body "$METRICS_BASE_URL/readyz" -H "Authorization: Bearer $METRICS_TOKEN"

METRICS_SERIES_ID=$(curl --fail-with-body -sS -X POST "$METRICS_BASE_URL/v1/series" \
  -H "Authorization: Bearer $METRICS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"manual-smoke-test"}' \
  | node -e 'let s="";process.stdin.on("data",c=>s+=c);process.stdin.on("end",()=>process.stdout.write(JSON.parse(s).seriesId))')
export METRICS_SERIES_ID

curl --fail-with-body -X POST "$METRICS_BASE_URL/v1/ingest" \
  -H "Authorization: Bearer $METRICS_TOKEN" -H 'Content-Type: application/json' \
  -H "Idempotency-Key: smoke-series-$METRICS_SERIES_ID" \
  -d "{\"points\":[{\"seriesId\":\"$METRICS_SERIES_ID\",\"ts\":\"2026-10-01T00:00:00Z\",\"value\":\"10.25\"}]}"
# Repeat the ingest command unchanged to check original-response replay.

curl --fail-with-body "$METRICS_BASE_URL/v1/series/$METRICS_SERIES_ID/latest" \
  -H "Authorization: Bearer $METRICS_TOKEN"
curl --fail-with-body -G "$METRICS_BASE_URL/v1/series/$METRICS_SERIES_ID/points" \
  -H "Authorization: Bearer $METRICS_TOKEN" \
  --data-urlencode 'from=2026-10-01T00:00:00Z' \
  --data-urlencode 'to=2026-10-31T00:00:00Z' --data-urlencode 'bucket=1h'
curl --fail-with-body "$METRICS_BASE_URL/v1/stats" -H "Authorization: Bearer $METRICS_TOKEN"
```

## Assignment load test and benchmark

PDF sections 3, 4, 5, 6.1, and 8 require runnable load/benchmark scripts, not manual Postman requests or only correctness tests. The commands below implement those runs. `npm run test:e2e` and the smoke commands above are correctness checks, not evidence of the two-million-point performance targets.

### Clean clone to loaded database

With Node.js/npm and Docker Compose installed, run from the repository root:

```bash
npm run load:setup
```

This installs locked dependencies, starts local Docker PostgreSQL, uses `DATABASE_URL` (Docker default: `metrics`), applies migrations, builds and launches a compiled API child, creates eight series through HTTP, and posts 2,000,000 points in 5,000-point batches with eight writers. It measures concurrent reads and API RSS, reconciles exact counts/sums and all hourly buckets, prints the manifest/report paths, then stops its own API process. It uses `.env.example` defaults when values are absent and respects existing environment/`.env` values without overwriting files. For local isolation run `npm run load:setup -- --database metrics_benchmark`.

The load generator writes through the API, not direct SQL. No separately running API is required. The application and PostgreSQL are the only service processes; the scripts are clients/measurement tools. Run against local Docker PostgreSQL, not a hosted database. Default host PostgreSQL port is `5433`.

For an already configured workspace:

```bash
npm run db:up
npm run load
```

These are **full-load commands** against your configured database's real `measurements` table. For a smaller isolated local verification:

```bash
npm run load -- --points 40000 --database metrics_benchmark_smoke
```

All four commands default to `DATABASE_URL`; `--database <name>` overrides only its database name, preserving credentials, host, port and connection options. The obsolete `BENCHMARK_DATABASE_URL` variable is ignored. Explicit names must be ASCII identifiers of 1–63 characters. Missing explicitly selected local databases can be created (requires database-creation permission); the default connects to an existing configured database without administrative access. Automatic creation is refused on remote servers. A cold run refuses existing measurements; nothing is deleted. Select a fresh local database for another cold run. Use the same `--database` override on every command for a given manifest. Manifests verify series ownership before replay. Avoid other API writes during measurements.

### Replay and separate benchmark command

Replace the example path with the manifest printed by the load command. The commands respectively run identical replay, idle-query/replay benchmarking, and strategy/index comparisons:

```bash
npm run load -- --manifest "artifacts/RUN-ID/manifest.json"
npm run benchmark -- --manifest "artifacts/RUN-ID/manifest.json"
npm run compare -- --manifest "artifacts/RUN-ID/manifest.json"
```

For the isolated example above, append `--database metrics_benchmark_smoke` to each command. Load/replay write through the API; comparison creates retained experimental tables in the selected database.

`benchmark` first checks reconciliation, measures 100 sequential requests each for latest and the fully loaded thirty-day hourly query, then measures replay and concurrent reads. It reports p95 degradation relative to the original cold-load report; a replay is not substituted for cold-write scenario F. Use `--samples 20` for a small verification (minimum 20). `compare` benchmarks UNNEST versus parameterized multi-row VALUES and an optional covering index on three isolated tables, saving actual `EXPLAIN (ANALYZE, BUFFERS)` for the exact shared API bucket SQL. The primary-key constraint stays intact. No production indexes are dropped or added.

### All acceptance scenarios

Choose a fresh full run, an existing loaded manifest, or a small correctness-only verification:

```bash
npm run acceptance
npm run acceptance -- --manifest "artifacts/RUN-ID/manifest.json"
npm run acceptance -- --points 5000 --samples 20 --database metrics_benchmark_acceptance_smoke
```

Acceptance A/B retain the primary load database. C–E run in another automatically created dedicated case database so they do not change A's exact row count. G uses another fresh dedicated database and the same total generator size as A: its first batch is held mid-insert by a database lock, termination is requested after PostgreSQL confirms an in-flight insert is waiting, the target batch/key rollback is verified, then the API restarts and retries the original manifest. It finishes with exact full-data reconciliation and another unchanged replay. If the lock was not observed or the emergency SIGKILL fallback was needed, the scenario fails rather than claiming success.

### Query tuning and session settings

Scenario G establishes its independent observer connection before ingestion, then waits at most ten seconds for an INSERT blocked specifically by its test blocker backend PID. It does not assume arrival within 1.7 seconds or accept an unrelated lock. Workload completion without the target lock fails immediately. This observer deadline does not change the production two-second lock timeout. Failed restart attempts retain `restart-failure-*.json` diagnostics and are marked failed in the acceptance summary; POSIX platform support is not labelled verified recovery when G failed.

Application and measurement/comparison connections start with UTC and `jit=off`; this is a session policy, not a server-wide setting or migration. The original full-scale plan spent approximately 646 ms on JIT compilation. The bucket query now aggregates each clipped bucket range through the existing primary-key index, avoiding `date_trunc`/hash grouping for every measurement, and joins the point at `max(ts)` for `last`. Exact NUMERIC aggregates, empty null buckets, UTC alignment and half-open range boundaries are unchanged. No optional index or cached/precomputed aggregate is introduced.

`compare` retains `beforeRewrite` and `afterRewrite` SQL timings and the original-query plan, using the same JIT-off connection policy. Reports include the actual `postgresJit` setting. Subsequent full-scale acceptance measured both API latency targets; both remain unmet, as recorded below. See `docs/query-performance-plan.md` for evidence and checkpoints.

### Cooperative ingest scheduling

Ingest hashing and validation now yield to Node's I/O loop between internal
100-point chunks (the current scheduling experiment, reduced from 250). SHA-256 consumes the same canonical bytes as before, preserving
existing saved request hashes. Successful ID/decimal normalization is cached only
within the current batch, and normalized decimal-string IDs are sorted numerically
without repeated BIGINT conversions. Pure validation/grouping retain original
rejection indexes and first-occurrence precedence across chunks.

This scheduling boundary does not change the 5,000-point request limit, the eight
admitted ingests, SQL batch size, or the single atomic batch transaction. It adds no
queue, worker, process or dependency. A 100-point chunk is not a guaranteed
millisecond budget: large fields, JSON parsing, grouping/sorting, and pg result
processing can still block. See [processing plan](docs/ingest-processing-plan.md)
for tests and before/after measurement scope.

The 100-point experiment was measured in full-scale run
`9b3a08d2-2b97-42d1-a8c1-2a86f01082ce`, reported at
`2026-10-07T19:16:07.608Z` (UTC), database `metrics_benchmark_chunk_100_01`.

| Measurement                         | 250-point baseline (`569d4d48…`) | 100-point chunks (`9b3a08d2…`) | Target        |
| ----------------------------------- | -------------------------------: | -----------------------------: | ------------- |
| Fresh throughput (points/sec)       |                        47,089.26 |                      45,419.21 | ≥20,000: pass |
| Latest p95 during writes (ms)       |                           118.30 |                          97.42 | ≤50: fail     |
| 30-day hourly bucket p95, idle (ms) |                           179.32 |                         183.45 | ≤150: fail    |
| Write duration (seconds)            |                            42.47 |                          44.03 | Informational |
| API sampled peak RSS (MiB)          |                           232.76 |                         242.87 | <512: pass    |

Both runs used 2,000,000 points, 5,000-point requests, eight writers and unchanged
SQL/pool/index settings on the same recorded machine. All A–G correctness checks
passed, exactly 2,000,000 rows were stored, replay inserted zero new rows and no
acceptance/load errors were reported. Observed latest p95 decreased 17.7% at a
3.5% throughput cost. This supports retaining 100-point chunks for the read-latency
trade-off, but repeated runs are needed to confirm consistency. Idle bucket SQL
was unchanged and its latency was essentially unchanged; both latency targets
remain unmet. Full details are preserved in the
[processing plan](docs/ingest-processing-plan.md), independently of ignored
artifacts. Typecheck, lint, build, formatting and 108 tests passed before the run.

### Cooperative measurement parameter experiment

The measured ingest optimization prepares measurement array parameters
cooperatively in 100-point chunks and reuses the encoded text for insertion and
mixed-batch classification. Strings remain bound parameters with the same SQL
casts, escaping and exact values—not interpolated SQL. This moves pg's large-array
encoding out of a single uninterrupted driver call; final joining and driver byte
encoding can still block. See [the parameter plan](docs/cooperative-parameters-plan.md).
Unprofiled acceptance run `46e89655-f881-44ac-a331-83868e0fccd1`, measured at
`2026-10-08T01:22:01.911Z` (UTC), used database
`metrics_benchmark_cooperative_params_01`.

| Measurement                         | 100-point baseline (`9b3a08d2…`) | Cooperative parameters (`46e89655…`) | Target        |
| ----------------------------------- | -------------------------------: | -----------------------------------: | ------------- |
| Fresh throughput (points/sec)       |                        45,419.21 |                            46,781.87 | ≥20,000: pass |
| Latest p95 during writes (ms)       |                            97.42 |                                85.62 | ≤50: fail     |
| 30-day hourly bucket p95, idle (ms) |                           183.45 |                               151.96 | ≤150: fail    |
| Write duration (seconds)            |                            44.03 |                                42.75 | Informational |
| API sampled peak RSS (MiB)          |                           242.87 |                               247.03 | <512: pass    |

Both runs used 2,000,000 points, 5,000-point requests, eight writers, pool size 12
and JIT off on the same recorded CPU/OS/Node/PostgreSQL configuration. Observed
throughput increased 3.0% and latest p95 decreased 12.1%; repeat runs are needed
to confirm consistency. Bucket SQL was unchanged, so its improvement is not
direct evidence of a query optimization; cache and run-to-run variation can
contribute. The bucket target still missed by 1.96 ms, and latest still exceeds
50 ms. Execution success is not full performance compliance.

All A–G correctness checks passed, including POSIX SIGTERM recovery. Stored rows
were exactly 2,000,000; replay inserted zero new rows, with processed input
175,728.64 points/sec (not fresh insertion throughput). No acceptance/load errors
were reported. Idle latest p95 was 3.60 ms and bucket p95 during writes was
429.97 ms; latest/bucket degradation was 2280.38%/182.95%. Typecheck, lint, build
and 119 tests passed before this run. These embedded measurements remain readable
without the ignored artifacts.

### UTC timestamp normalization experiment

After full calendar, timezone and PostgreSQL-bound validation, ordinary positive
four-digit-year `Z` timestamps reuse their input calendar fields for SQL text.
Exact microseconds are still computed for point identity and range validation;
fractions are padded to six digits without rounding. Signed/expanded years, BC
dates and timezone offsets retain the existing general formatter. This avoids
the redundant microseconds-to-calendar conversion without changing the API,
database schema, request fingerprint or transaction boundaries.

Unprofiled run `f2ac9857-d440-4412-afbc-90e2add25e68`, measured at
`2026-10-08T02:18:13.571Z` (UTC), used database
`metrics_benchmark_timestamp_fast_path_01`.

| Measurement                         | Previous (`46e89655…`) | UTC fast path (`f2ac9857…`) | Target        |
| ----------------------------------- | ---------------------: | --------------------------: | ------------- |
| Fresh throughput (points/sec)       |              46,781.87 |                   51,463.39 | ≥20,000: pass |
| Latest p95 during writes (ms)       |                  85.62 |                       72.75 | ≤50: fail     |
| 30-day hourly bucket p95, idle (ms) |                 151.96 |                      152.01 | ≤150: fail    |
| Write duration (seconds)            |                  42.75 |                       38.86 | Informational |
| API sampled peak RSS (MiB)          |                 247.03 |                      239.34 | <512: pass    |

Both runs used 2,000,000 points, 5,000-point requests, eight writers, pool 12 and
JIT off on the same recorded machine/software configuration. Observed throughput
increased 10.0% and latest p95 decreased 15.0%. Retain the fast path, with repeated
runs needed to confirm consistency; this single comparison does not isolate all
machine/cache variation. Bucket SQL was unchanged and idle bucket latency was
essentially unchanged. Both latency targets remain unmet.

All A–G correctness checks and POSIX SIGTERM recovery passed. Exactly 2,000,000
rows were stored, replay inserted zero new rows, and no acceptance/load errors
were reported. Replay processed input at 176,276.06 points/sec, not fresh insert
throughput. Bucket p95 during writes was 389.37 ms; idle latest p95 was 3.43 ms.
Latest/bucket degradation was 2021.23%/156.14%. Typecheck, lint, build and 147
tests passed before this measurement. These results do not depend on ignored
artifacts being submitted. See
[the timestamp plan](docs/timestamp-normalization-plan.md).

### Canonical point hashing experiment

The fixed-key fast path for standard string-valued points was measured, then
removed at the user's request. Generic canonical sorting is restored; whole-body
SHA-256, original spellings, extra fields, array order and 100-point yielding
remain unchanged. The timestamp fast path is retained.

| Measurement                         | Timestamp baseline (`f2ac9857…`) | Hash run 1 (`879b1b53…`) | Hash run 2 (`8f2d787e…`) |
| ----------------------------------- | -------------------------------: | -----------------------: | -----------------------: |
| Fresh throughput (points/sec)       |                        51,463.39 |                54,610.45 |                49,426.24 |
| Latest p95 during writes (ms)       |                            72.75 |                    98.88 |                   101.58 |
| 30-day hourly bucket p95, idle (ms) |                           152.01 |                   178.80 |                   172.75 |
| Write duration (seconds)            |                            38.86 |                    36.62 |                    40.46 |
| API sampled peak RSS (MiB)          |                           239.34 |                   228.22 |                   225.80 |

Both hashing runs stored exactly 2,000,000 rows, passed A–G including POSIX
SIGTERM recovery, replayed without new rows and reported no acceptance/load
errors. Settings remained 5,000-point requests, eight writers, pool 12 and JIT off
on the same recorded machine/software configuration. Lower sampled memory did
not establish a consistent throughput or read-latency benefit. Both latency
targets failed. Sequential runs cannot prove causation. The removal comparison
`25b93ce8-9e25-4d77-9cef-88bc0c989cf2`, measured at UTC
`2026-10-08T02:53:20.681Z` in `metrics_benchmark_without_hash_fast_path_01`,
returned 50,570.24 points/sec, latest write p95 78.92 ms, idle bucket p95 166.48 ms,
write duration 39.55 seconds and peak API RSS 239.03 MiB. All A–G checks and
POSIX SIGTERM recovery passed, rows were exactly 2,000,000, replay added zero
rows and no errors were reported. Latest latency recovered closer to the
timestamp-only baseline, supporting removal without proving causation; both
latency budgets remain unmet. Rollback checks passed all 161 tests, typecheck,
lint and build. See
[the hashing plan](docs/canonical-point-hashing-plan.md).

### Cooperative point grouping experiment

Cooperative grouping was tested twice, then removed at the user's request.
The original synchronous Map scan and deterministic candidate sort are restored.
Existing cooperative hashing, validation and parameter encoding remain unchanged;
timestamp optimization is retained. SQL and transaction boundaries never changed.

| Measurement                         | Baseline (`25b93ce8…`) | Grouping run 1 (`dd4b3eec…`) | Grouping run 2 (`849c4612…`) |
| ----------------------------------- | ---------------------: | ---------------------------: | ---------------------------: |
| Fresh throughput (points/sec)       |              50,570.24 |                    47,953.19 |                    48,136.41 |
| Latest p95 during writes (ms)       |                  78.92 |                        80.64 |                        78.81 |
| 30-day hourly bucket p95, idle (ms) |                 166.48 |                       157.54 |                       201.76 |
| Write duration (seconds)            |                  39.55 |                        41.71 |                        41.55 |
| API sampled peak RSS (MiB)          |                 239.03 |                       249.07 |                       240.29 |

Both experiments used 2,000,000 points, 5,000-point requests, eight writers,
pool 12 and JIT off on the same recorded machine/software configuration. All A–G
checks and POSIX SIGTERM recovery passed, stored rows were exactly 2,000,000,
replay added zero rows and no acceptance/load errors were reported. Throughput
decreased approximately 5% without a meaningful latest-latency benefit. Both
latency targets failed. Idle bucket variability despite unchanged SQL prevents
attributing its changes directly to grouping. These sequential runs support
removal but do not isolate all machine/cache effects.
See [the grouping plan](docs/cooperative-grouping-plan.md).

### Current covering-index experiment — not adopted

An additional `(series_id, ts) INCLUDE (value)` index was created manually only in
isolated benchmark databases. No permanent migration or main-database change was
made. Fresh loads measured 41,455.34 and 46,296.87 points/sec versus the no-index
baseline of 50,570.24 (approximately 8–18% lower). Idle bucket p95 was 144.68 and
165.58 ms, so the ≤150 ms target did not pass consistently. Latest write p95 was
94.68 and 83.51 ms; both failed ≤50 ms. All A–G execution/correctness checks
passed, rows were exact, replay added zero rows and no errors were reported.

The second indexed database still required approximately 49,000 heap fetches per
checked aggregate scan. Manual VACUUM ANALYZE there eliminated those fetches;
the subsequent idle HTTP benchmark measured bucket p95 **150.101231 ms**, still
technically above target, and latest p95 4.85 ms. This is post-maintenance
evidence, not a replacement for the original fresh-load results. Fresh-maintained
covering indexes occupied about 130.24/130.33 MiB; the index built after an
existing load occupied 77.375 MiB. These sizes exclude other storage and WAL.

Decision: keep the index experimental. Existing test indexes remain for
inspection, but production retains its current schema. See
[covering-index results and caveats](docs/covering-index-experiment.md) for full
measurements, run identities, visibility-map evidence and next investigation.

### Optional one-off API CPU profile

```bash
npm run load -- --points 2000000 --database metrics_benchmark_cpu_profile_01 --profile-api
```

This starts the API automatically and profiles only the benchmark-owned API,
not the load generator. The final `cpu_profile_saved` message prints a unique
`artifacts/api-<uuid>.cpuprofile` path. The script saves the profile before normal
API shutdown; a failed save reports an error. Open the file in a CPU-profile viewer
or share its filename for analysis. Local inspector profiling exposes no debug port
and adds no dependency. The profile includes startup, writes, reads and final
reconciliation; focus analysis on the write interval rather than startup costs.

Profiling adds overhead. Its load JSON is labelled `diagnosticOnly: true`; do not
use its timings as final acceptance/compliance results. Ordinary load/acceptance
runs do not enable profiling. The flag is supported only by `npm run load`, not
acceptance/compare/benchmark. Files can contain local source paths and function
names; keep profiles in ignored artifacts. See [the plan](docs/api-cpu-profile-plan.md).

### Readable run summary

Each acceptance run generates `REPORT.md` beside `acceptance.json`. Start with that Markdown file: it lists workload/machine identity, performance targets and actual measurements, A–G correctness results, pending independent checks, and links to JSON evidence. The terminal prints `markdownPath`, including for failed runs that reach report generation. Correctness success is separate from performance compliance; small/replay runs do not certify fresh two-million-point targets. New reports record the database name without credentials. Older JSON may show `Database: Not recorded`.

Generate the same summary for an existing acceptance JSON without rerunning any API or database work:

```bash
npm run report -- --input "artifacts/acceptance-RUN-ID/acceptance.json"
```

The generator never overwrites an existing `REPORT.md` or modifies JSON. Strategy/index comparisons and unit/E2E suites remain separate evidence; their completion is not inferred by the acceptance summary. Reports are generated after measurements, not during timed requests.

`compare` also automatically generates a readable `COMPARISON.md` beside its JSON and prints `markdownPath`. It includes insert-kernel throughput, optional-index write/read changes, recorded relation sizes, exact reconciliation, actual SQL plans (including timeout evidence), machine details and limitations. These direct SQL measurements are not HTTP performance certification. If `COMPARISON.md` already exists, the next report uses its unique `comparison-<timestamp>-<id>.md` name instead; previous summaries are preserved.

For an existing comparison, without rerunning benchmarks or accessing the database:

```bash
npm run report -- --input "artifacts/acceptance-RUN-ID/DATASET-ID/comparison-TIMESTAMP-ID.json"
```

Older comparison JSON may omit database/workload metadata; the summary marks it Not recorded rather than inventing it. Comparison plans and trade-offs must still be reviewed before adopting any production optimization.

### Platform support and restart semantics

The tooling uses Node APIs for HTTP, timing, paths, and RSS measurement and is designed for Linux, macOS, and Windows with Node.js 20+ and local PostgreSQL/Docker Compose. Setup invokes npm's JavaScript CLI through the current Node executable, not a Windows `.cmd` file. Use the same npm commands above on each OS; configure connection settings in `.env`, and quote manifest paths containing spaces. Only Linux has been exercised locally; Windows/macOS execution is not claimed as verified.

The benchmark starts the API with a strictly typed, benchmark-only preload module. During measurement windows, it samples `process.memoryUsage.rss()` in that API process and sends values through Node IPC to the load client. The ordinary API bootstrap does not load it. No endpoint, runtime service, or dependency is added. PID/window checks prevent another process or stale readings from contaminating a report.

Linux/macOS scenario G uses POSIX SIGTERM. On native Windows, Node terminates a child forcefully rather than delivering a POSIX graceful-shutdown signal. Reports explicitly label this as `windows-forced-termination` and set `posixSigtermScenario: false`; the test still checks transactional rollback, restart, and unchanged replay, but does not prove the PDF's POSIX SIGTERM behavior. Windows users should run the POSIX acceptance test under WSL2 or another POSIX environment for that evidence. See Node's [RSS API](https://nodejs.org/api/process.html#processmemoryusagerss) and [child termination documentation](https://nodejs.org/api/child_process.html#subprocesskillsignal).

Reports, manifests, aggregate snapshots, and payload-free API logs live under ignored `artifacts/`. Every report gets a new filename; previous results are not overwritten. Databases and experiment tables are retained for inspection. **Full acceptance loads a second two-million-point dataset for G; comparison retains three more dataset copies. Allow additional disk/WAL beyond a single-load estimate.** No reset/drop/delete command is run automatically. Do not run benchmarks concurrently with each other, correctness tests, or unrelated workloads when recording final results.

Required execution sequence and evidence:

| Scenario                  | API/script behavior and required evidence                                                                                                                                                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A — Cold load             | Create series through `POST /v1/series`; deterministically generate 2,000,000 unique points; post 400 batches of 5,000 through `POST /v1/ingest` with 8 concurrent writers and stable batch keys. Time the load; verify exactly 2,000,000 stored rows with stats and SQL. Target: at least 20,000 points/sec. |
| B — Replay                | Reuse the same series IDs, points, batch order, and keys from A. Report replay wall time and verify unchanged counts and every aggregate. A saved response's accepted count is not evidence of a new insert.                                                                                                  |
| C — Concurrent duplicates | Post an identical batch simultaneously from two writers; verify no deadlock, lost row, or double count. Include intra-batch duplicate identities, which require deduplication before a conflict-update strategy can safely run.                                                                               |
| D — Partial failure       | Submit 5,000 rows including an invalid decimal, invalid timestamp, nonexistent series, and internal duplicate. Check all good rows persist and every rejected index/reason is correct.                                                                                                                        |
| E — Late arrival          | Query a bucket, insert older points, then query again. Verify aggregates update and latest remains the newest timestamp rather than the last arrival.                                                                                                                                                         |
| F — Reads during writes   | While A is actively writing, repeatedly call both latest and the 30-day hourly-bucket endpoint. Report each p95 and degradation against idle reads. Latest target: p95 ≤ 50 ms; bucket target: p95 ≤ 150 ms. Also measure the 30-day hourly query after the table is fully loaded.                            |
| G — Restart               | SIGTERM the application during a separately generated load of the requested size, restart, and resume/replay with unchanged data and keys. Verify exact final count, no duplicates, and no half-written target batch. Full-scale recovery passed in the latest recorded run.                                  |

The generator persists a reproducible manifest containing series IDs, generation parameters, and exact expected per-series counts/sums; stable request keys derive from its run ID and batch index. Reuse it for replay and restart; creating new series would not test replay. Values are signed integer cents rendered as decimal strings, and expected sums use BigInt arithmetic. Points span thirty days deterministically, with unique millisecond timestamps within each series. At most one batch per writer is generated in memory.

429/503 and network failures have bounded retries with unchanged bodies/keys. Every attempt records its duration and status; replay throughput reports zero newly inserted points/sec rather than summing cached accepted counts. Reports also show processed-input throughput and replay wall time. Reader loops do not retry, so failed reads remain visible. Average verification follows the documented finite PostgreSQL NUMERIC division contract; count/sum/min/max/last and replay equality are independently checked without floating-point value arithmetic.

The managed **application process** RSS is sampled every 100 ms using its own `process.memoryUsage.rss()` over IPC (target: below 512 MB); Docker database/generator memory is not substituted. Measurement includes immediate and final samples while the child is alive. Reports include PID, source, sampling count, final-sample availability, and telemetry errors; missing telemetry is null, never invented zero memory. A terminated child retains its readings without waiting for a final sample it cannot send. Report CPU, RAM, PostgreSQL version, Docker usage, actual throughput, replay duration, row counts, both latency percentiles, and peak sampled RSS. Percentiles use nearest rank; successful and failed attempt durations/statuses are reported separately. Cold-load readers rotate across all eight series, run independently, and issue a request per category with a 100 ms pause. The range has 720 hourly buckets per series. A small run's metrics are verification evidence only. Full-scale measurements are recorded below; both latency targets remain unmet.

### Reconciliation SQL

The load script automatically executes equivalent SQL restricted to manifest series and compares every count and exact sum to generated expectations. To inspect the primary benchmark database manually, run this query and compare it with the manifest. Experiment tables and C–G case databases are outside these business-table totals.

```sql
SELECT s.id::text AS series_id, s.name,
       count(m.series_id)::text AS point_count,
       sum(m.value)::text AS value_sum
FROM series s
LEFT JOIN measurements m ON m.series_id = s.id
GROUP BY s.id, s.name
ORDER BY s.id;
```

### Index rationale and remaining measured evidence

Measurements primary-key write cost can be reproduced separately on isolated
tables in an already loaded local benchmark database:

```bash
npm run index:cost -- --manifest "artifacts/acceptance-d01edefe-2d5a-4ec2-ad86-4ff865f8b64d/1106e95e-fc3c-4830-983d-10db4d1d9ff7/manifest.json" --database metrics_benchmark_covering_fresh_02
```

Substitute your own manifest and its database; the eight series must exist there.
An explicit non-main local database is required. Add `--points 40000` for a smoke
test only. Two fresh experiment tables are created with the same checks and
foreign key. The primary key is physically dropped from one; identical plain
ordered UNNEST INSERTs load unique points into both, with 5,000-point batches and
eight writers. JSON and `REPORT.md` record exact reconciliation, actual schemas,
throughput and sizes. Tables are retained; no business-table rows or indexes are
modified. Allow storage for two additional dataset copies.

This is direct database write-kernel evidence, not HTTP acceptance or safe
production deduplication. Generation/pg overhead is included; DDL and
reconciliation are outside the write timer. PK-first sequential ordering and
cache/checkpoint/machine variation limit causal attribution. It does not measure
series or request-key index costs. See
[the primary-key cost plan](docs/primary-index-cost-plan.md).

Measured on 2026-10-08 at 04:11 UTC in `metrics_benchmark_covering_fresh_02`
(Intel i3-7020U, four logical CPUs, Node 20.18.0, PostgreSQL 17.11 in Docker,
JIT off, direct SQL pool of eight):

| Direct write-kernel check      | Primary key retained | Primary key physically removed |
| ------------------------------ | -------------------: | -----------------------------: |
| Inserted rows                  |            2,000,000 |                      2,000,000 |
| Throughput (points/sec)        |           104,011.64 |                     114,589.40 |
| Write duration                 |              19.23 s |                        17.45 s |
| Index bytes                    |           65,011,712 |                              0 |
| Per-series count and exact sum |    All eight matched |              All eight matched |

The primary-key variant had **9.23% lower throughput** in this single sequential
trial. This is measured overhead, not a recommendation to remove the required
identity index. Both variants retained their foreign key and checks. Experiment
tables are `bench_pkcost_25866a0dbfc94d60_pk` and
`bench_pkcost_25866a0dbfc94d60_heap`; evidence is in
`artifacts/primary-index-cost-bd69feb3-1490-438b-aaeb-ef7638b782fa/REPORT.md`
and its `report.json`. These direct SQL rates do not replace the HTTP target
achievement table above. Artifacts remain local; this embedded summary travels
with the repository.

| Index                                    | Purpose and write cost                                                                                          |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `series_pkey (id)`                       | Series identity, lookup, and referenced-key integrity. Updated on series creation, not each measurement insert. |
| `measurements_pkey (series_id, ts)`      | Required point identity, range scans, and backward latest lookup. Maintained on each new point.                 |
| `ingest_requests_pkey (idempotency_key)` | Atomic key claim and replay lookup. Maintained once per new batch request.                                      |
| `schema_migrations_pkey (name)`          | Migration bookkeeping only; not part of normal ingest traffic.                                                  |

#### Series and request-key synthetic write costs

```bash
npm run index:cost:remaining -- --database metrics_benchmark_covering_fresh_02
```

Use your existing local non-main database. No manifest or running API is needed.
Default: 100,000 synthetic rows per variant, 5,000 rows/batch, eight workers.
For a smoke check add `--points 10000`. Four fresh isolated tables are created;
their checks, NOT NULL rules and series identity generation are preserved. Each
pair differs only in its physically retained/dropped primary key. Plain INSERTs
are identical within a pair; there is no conflict handling or API hashing.
Verification checks exact counts, distinct key/identity coverage and request
payloads. Actual catalog constraints/indexes, sizes, machine and timings appear
in unique JSON and `REPORT.md` files. Tables are retained, never overwritten.

Measured 2026-10-08 at 04:30–04:31 UTC on the same i3/Node/PostgreSQL machine
above, JIT off and direct SQL pool=8:

| Synthetic comparison    | Rows per variant | With PK rows/sec | Without PK rows/sec | With/without PK duration |  PK bytes |
| ----------------------- | ---------------: | ---------------: | ------------------: | ------------------------ | --------: |
| Series, initial trial   |          100,000 |       161,888.38 |          344,724.32 | 0.62 / 0.29 s            | 2,244,608 |
| Requests, initial trial |          100,000 |        64,612.15 |           96,008.40 | 1.55 / 1.04 s            | 5,201,920 |
| Series, repeat          |          100,000 |       155,567.08 |          403,792.87 | 0.64 / 0.25 s            | 2,244,608 |
| Requests, repeat        |          100,000 |        66,142.81 |           89,786.83 | 1.51 / 1.11 s            | 5,242,880 |

All four variants in both trials passed exact data reconciliation. No-PK index
bytes were zero. Reports:
`artifacts/remaining-index-cost-55af70f7-b15e-4c80-9cde-1cfdc2e3138f/REPORT.md`
and `artifacts/remaining-index-cost-44362656-7950-4037-93ce-7eee717b1ea3/REPORT.md`.
The repeat followed a null-safe request-payload verification tightening; insertion
SQL and workload were unchanged. Consult each JSON for exact retained table names.

These are **experimental direct-insert rates**, not measurement points/sec or
end-to-end ingest throughput. The actual acceptance dataset uses eight series
and 400 batch request records, not 100,000 of each. Request keys are deterministic
ordered strings with a fixed valid hash/response; real key distributions and
request claim/update/replay behavior can cost differently. Particularly short
series trials, indexed-first order, cache/checkpoint variation and driver work
prevent precise attribution of percentages. Keep both production keys: identity
and atomic idempotency require them. Do not use these results to change the HTTP
target achievement table. See [design](docs/remaining-index-cost-design.md).

The comparison report includes real lookup plans, bucket plans, relation/index sizes, insert timings with/without the optional covering index, and twenty measured query samples per indexed configuration. It also disables index/bitmap/index-only scans locally in a rolled-back read transaction to show a no-index-access plan without dropping correctness constraints. That diagnostic has a 30-second timeout; a timeout is recorded as a measured failure, not fabricated EXPLAIN output.

Strategy comparisons are **insert-kernel microbenchmarks** with identical point constraints, batch scope, eight writers, and ordered identities. They exclude HTTP validation, payload hashing, request records, and post-insert classification; their throughput is not the API's end-to-end throughput. The production load report supplies that measurement. Experiments run sequentially, so cache/order noise requires repeated runs before choosing an optimization.

#### Required-index lookup plans: physically indexed versus unindexed copies

Reproduce after generating the primary and remaining index-cost reports above.
Use the JSON paths printed by your own runs; historical artifacts are ignored and
are not needed once you generate replacements. This command does not load data,
start an API, or alter production indexes:

```bash
npm run index:plans -- --database metrics_benchmark_covering_fresh_02 --manifest artifacts/primary-index-cost-bd69feb3-1490-438b-aaeb-ef7638b782fa/report.json --keys-report artifacts/remaining-index-cost-44362656-7950-4037-93ce-7eee717b1ea3/report.json
```

Measured 2026-10-08T04:42:50.698Z on the same machine above, JIT off, direct SQL pool=1.
The script verifies exact table counts and physical index counts (one versus
zero), applies ANALYZE only to experiment tables, warms each query, then collects
20 samples per variant with alternating order. All queried results matched
exactly. Measurements have two million rows, including 250,000 in the queried
series; the series/request tables have 100,000 synthetic rows each.

| Idle direct SQL query  | Table rows | With PK p95 ms | Without PK p95 ms |
| ---------------------- | ---------: | -------------: | ----------------: |
| Latest measurement     |  2,000,000 |          1.522 |           204.859 |
| 30-day range aggregate |  2,000,000 |         79.097 |           190.376 |
| Series ID lookup       |    100,000 |          0.875 |            11.130 |
| Request replay lookup  |    100,000 |          0.897 |            20.225 |

Latest uses a backward index scan instead of a parallel scan and top-N sort.
The range aggregate uses a bitmap index/heap scan instead of scanning the full
heap. Series/request lookups use index-only/index scans instead of filtering
99,999 unrelated rows. These results justify retaining the three required
business primary keys despite the write overhead measured above. They do not
establish the cause of the remaining HTTP latency misses, and do not replace
30-day hourly bucket or latest-during-writes acceptance measurements.

The range comparison is one count/sum/min/max query over a month, **not** the
720-bucket endpoint. Raw before/after bucket evidence is retained elsewhere in
this README. The projected series ID matches even though concurrent identity
allocation can assign different names to the same ID in the two synthetic runs.
Request replay compares the actual stored hash and JSON response. Statistics,
cache state, synthetic key sizes, short repeated trials and host variation limit
generalization. No forced planner flags or production index removal were used.

Generated evidence: `artifacts/index-lookups-1195d31c-cd43-4e92-8231-1bffd6ee2722/REPORT.md`
and its `report.json`. All eight original EXPLAIN outputs follow so the evidence
is available in a clean clone without committing artifacts. SQL uses the bound
parameters shown for each pair; text plan execution time is one server sample,
not the repeated driver-visible p95 above.

##### Latest measurement

Parameters: `["1"]`. Matching results verified on both tables.

With primary key: **yes**. Direct SQL p50/p95: 0.861 / 1.522 ms.

```sql
EXPLAIN (ANALYZE, BUFFERS) SELECT m.ts::text,m.value::text FROM "bench_pkcost_25866a0dbfc94d60_pk" AS m WHERE m.series_id=$1::bigint ORDER BY m.ts DESC LIMIT 1;
```

```text
Limit  (cost=0.43..0.68 rows=1 width=72) (actual time=0.028..0.028 rows=1 loops=1)
  Buffers: shared hit=4
  ->  Index Scan Backward using bench_pkcost_25866a0dbfc94d60_pk_pkey on bench_pkcost_25866a0dbfc94d60_pk m  (cost=0.43..61195.87 rows=245800 width=72) (actual time=0.027..0.027 rows=1 loops=1)
        Index Cond: (series_id = '1'::bigint)
        Buffers: shared hit=4
Planning Time: 0.086 ms
Execution Time: 0.047 ms
```

With primary key: **no**. Direct SQL p50/p95: 169.305 / 204.859 ms.

```sql
EXPLAIN (ANALYZE, BUFFERS) SELECT m.ts::text,m.value::text FROM "bench_pkcost_25866a0dbfc94d60_heap" AS m WHERE m.series_id=$1::bigint ORDER BY m.ts DESC LIMIT 1;
```

```text
Limit  (cost=25705.52..25705.63 rows=1 width=72) (actual time=200.556..204.530 rows=1 loops=1)
  Buffers: shared hit=2794 read=10023
  ->  Gather Merge  (cost=25705.52..49753.36 rows=206110 width=72) (actual time=200.553..204.526 rows=1 loops=1)
        Workers Planned: 2
        Workers Launched: 2
        Buffers: shared hit=2794 read=10023
        ->  Sort  (cost=24705.49..24963.13 rows=103055 width=72) (actual time=195.328..195.329 rows=1 loops=3)
              Sort Key: ts DESC
              Sort Method: top-N heapsort  Memory: 25kB
              Buffers: shared hit=2794 read=10023
              Worker 0:  Sort Method: top-N heapsort  Memory: 25kB
              Worker 1:  Sort Method: top-N heapsort  Memory: 25kB
              ->  Parallel Seq Scan on bench_pkcost_25866a0dbfc94d60_heap m  (cost=0.00..24190.22 rows=103055 width=72) (actual time=0.749..162.919 rows=83333 loops=3)
                    Filter: (series_id = '1'::bigint)
                    Rows Removed by Filter: 583333
                    Buffers: shared hit=2720 read=10023
Planning Time: 0.121 ms
Execution Time: 204.570 ms
```

##### 30-day range aggregate

Parameters: `["1","2026-09-01T00:00:00Z","2026-10-01T00:00:00Z"]`. Matching results verified on both tables.

With primary key: **yes**. Direct SQL p50/p95: 69.031 / 79.097 ms.

```sql
EXPLAIN (ANALYZE, BUFFERS) SELECT count(*)::text,sum(value)::text,min(value)::text,max(value)::text FROM "bench_pkcost_25866a0dbfc94d60_pk" WHERE series_id=$1::bigint AND ts >= $2::timestamptz AND ts < $3::timestamptz;
```

```text
Finalize Aggregate  (cost=23596.89..23596.92 rows=1 width=128) (actual time=90.123..93.855 rows=1 loops=1)
  Buffers: shared hit=2968
  ->  Gather  (cost=23596.65..23596.86 rows=2 width=104) (actual time=89.960..93.829 rows=3 loops=1)
        Workers Planned: 2
        Workers Launched: 2
        Buffers: shared hit=2968
        ->  Partial Aggregate  (cost=22596.65..22596.66 rows=1 width=104) (actual time=85.347..85.349 rows=1 loops=3)
              Buffers: shared hit=2968
              ->  Parallel Bitmap Heap Scan on bench_pkcost_25866a0dbfc94d60_pk  (cost=7037.75..21572.69 rows=102396 width=6) (actual time=21.060..43.010 rows=83333 loops=3)
                    Recheck Cond: ((series_id = '1'::bigint) AND (ts >= '2026-09-01 00:00:00+00'::timestamp with time zone) AND (ts < '2026-10-01 00:00:00+00'::timestamp with time zone))
                    Heap Blocks: exact=618
                    Buffers: shared hit=2968
                    ->  Bitmap Index Scan on bench_pkcost_25866a0dbfc94d60_pk_pkey  (cost=0.00..6976.32 rows=245751 width=0) (actual time=24.528..24.528 rows=250000 loops=1)
                          Index Cond: ((series_id = '1'::bigint) AND (ts >= '2026-09-01 00:00:00+00'::timestamp with time zone) AND (ts < '2026-10-01 00:00:00+00'::timestamp with time zone))
                          Buffers: shared hit=969
Planning Time: 0.103 ms
Execution Time: 93.899 ms
```

With primary key: **no**. Direct SQL p50/p95: 149.576 / 190.376 ms.

```sql
EXPLAIN (ANALYZE, BUFFERS) SELECT count(*)::text,sum(value)::text,min(value)::text,max(value)::text FROM "bench_pkcost_25866a0dbfc94d60_heap" WHERE series_id=$1::bigint AND ts >= $2::timestamptz AND ts < $3::timestamptz;
```

```text
Finalize Aggregate  (cost=29356.92..29356.95 rows=1 width=128) (actual time=146.942..151.587 rows=1 loops=1)
  Buffers: shared hit=4832 read=7911
  ->  Gather  (cost=29356.69..29356.90 rows=2 width=104) (actual time=146.837..151.569 rows=3 loops=1)
        Workers Planned: 2
        Workers Launched: 2
        Buffers: shared hit=4832 read=7911
        ->  Partial Aggregate  (cost=28356.69..28356.70 rows=1 width=104) (actual time=142.898..142.899 rows=1 loops=3)
              Buffers: shared hit=4832 read=7911
              ->  Parallel Seq Scan on bench_pkcost_25866a0dbfc94d60_heap  (cost=0.00..27326.33 rows=103035 width=6) (actual time=0.086..109.844 rows=83333 loops=3)
                    Filter: ((ts >= '2026-09-01 00:00:00+00'::timestamp with time zone) AND (ts < '2026-10-01 00:00:00+00'::timestamp with time zone) AND (series_id = '1'::bigint))
                    Rows Removed by Filter: 583333
                    Buffers: shared hit=4832 read=7911
Planning Time: 0.080 ms
Execution Time: 151.625 ms
```

##### Series ID lookup

Parameters: `["50000"]`. Matching results verified on both tables.

With primary key: **yes**. Direct SQL p50/p95: 0.713 / 0.875 ms.

```sql
EXPLAIN (ANALYZE, BUFFERS) SELECT id::text FROM "bench_keycost_9146fce308bc4b94_series_pk" WHERE id=$1::bigint;
```

```text
Index Only Scan using bench_keycost_9146fce308bc4b94_series_pk_pkey on bench_keycost_9146fce308bc4b94_series_pk  (cost=0.29..4.32 rows=1 width=32) (actual time=0.011..0.012 rows=1 loops=1)
  Index Cond: (id = '50000'::bigint)
  Heap Fetches: 0
  Buffers: shared hit=3
Planning Time: 0.044 ms
Execution Time: 0.023 ms
```

With primary key: **no**. Direct SQL p50/p95: 7.833 / 11.130 ms.

```sql
EXPLAIN (ANALYZE, BUFFERS) SELECT id::text FROM "bench_keycost_9146fce308bc4b94_series_heap" WHERE id=$1::bigint;
```

```text
Seq Scan on bench_keycost_9146fce308bc4b94_series_heap  (cost=0.00..1891.01 rows=1 width=32) (actual time=3.784..7.404 rows=1 loops=1)
  Filter: (id = '50000'::bigint)
  Rows Removed by Filter: 99999
  Buffers: shared hit=641
Planning Time: 0.034 ms
Execution Time: 7.418 ms
```

##### Request replay lookup

Parameters: `["cost:0000050000"]`. Matching results verified on both tables.

With primary key: **yes**. Direct SQL p50/p95: 0.740 / 0.897 ms.

```sql
EXPLAIN (ANALYZE, BUFFERS) SELECT encode(payload_hash,'hex') AS payload_hash,response_body FROM "bench_keycost_9146fce308bc4b94_requests_pk" WHERE idempotency_key=$1;
```

```text
Index Scan using bench_keycost_9146fce308bc4b94_requests_pk_pkey on bench_keycost_9146fce308bc4b94_requests_pk  (cost=0.42..8.44 rows=1 width=107) (actual time=0.020..0.021 rows=1 loops=1)
  Index Cond: ((idempotency_key)::text = 'cost:0000050000'::text)
  Buffers: shared hit=4
Planning Time: 0.043 ms
Execution Time: 0.031 ms
```

With primary key: **no**. Direct SQL p50/p95: 13.428 / 20.225 ms.

```sql
EXPLAIN (ANALYZE, BUFFERS) SELECT encode(payload_hash,'hex') AS payload_hash,response_body FROM "bench_keycost_9146fce308bc4b94_requests_heap" WHERE idempotency_key=$1;
```

```text
Seq Scan on bench_keycost_9146fce308bc4b94_requests_heap  (cost=0.00..3175.00 rows=1 width=107) (actual time=7.784..10.606 rows=1 loops=1)
  Filter: ((idempotency_key)::text = 'cost:0000050000'::text)
  Rows Removed by Filter: 99999
  Buffers: shared hit=1925
Planning Time: 0.037 ms
Execution Time: 10.619 ms
```

## Recorded assignment measurements

The following evidence is required by PDF §3, §5 and §8 and is preserved here because local artifacts are git-ignored. Full earlier summaries and rewrite JSON plans are retained in [measurement history](docs/measurement-history.md). Numbers below are measured, not estimates; execution/correctness success is separate from performance compliance.

### Diagnostics overhead experiment and rollback

The subsequent measured optimization is a fresh-insert fast path: when the
measurement INSERT reports that every deduplicated candidate was inserted, skip
the subsequent classification SELECT and derive accepted/internal-duplicate
counts from the candidate groups. Mixed or all-existing batches retain the
original classification query. Validation, request replay, exact values and the
single transaction are unchanged. Run `22d030f8-8bbd-4e1e-84df-07e908d5523a`
measured 39,941.76 points/sec and latest p95 130.71 ms versus the diagnostics-removed
baseline below (29,988.61 points/sec and 185.27 ms). All A–G checks passed, but
latest still missed 50 ms and idle buckets measured 177.13 ms, missing 150 ms.
See [the fast-path plan](docs/fresh-insert-fast-path-plan.md) for the full comparison
and limits of the single-run evidence.

The next measured change reduces INSERT response traffic: a SQL CTE returns one count
row and no identities for fully fresh batches, returning inserted identities only
when mixed-batch classification needs them. The outer SELECT always returns one
row; its row count is not the inserted count. Transaction and fallback behavior
remain unchanged. Run `569d4d48-34e2-48c4-92f6-64c67987ddc4`, reported at
`2026-10-07T18:53:24.476Z` (UTC), used `metrics_benchmark_compact_insert_01`.

| Measurement                         | Previous fast path | Compact result | Target        |
| ----------------------------------- | -----------------: | -------------: | ------------- |
| Fresh throughput (points/sec)       |          39,941.76 |      47,089.26 | ≥20,000: pass |
| Latest p95 during writes (ms)       |             130.71 |         118.30 | ≤50: fail     |
| 30-day hourly bucket p95, idle (ms) |             177.13 |         179.32 | ≤150: fail    |
| Write duration (seconds)            |              50.07 |          42.47 | Informational |
| API sampled peak RSS (MiB)          |             234.09 |         232.76 | <512: pass    |

All A–G checks passed; exactly 2,000,000 points were stored, replay inserted zero
new rows, and no acceptance/load errors were reported. Observed throughput rose
17.9% and latest p95 fell 9.5%; repeated runs are needed to confirm consistency.
The unchanged idle bucket SQL showed essentially unchanged latency. Both latency
targets remain unmet. Full details are preserved in
[the compact-result plan](docs/compact-insert-result-plan.md), independently of
ignored local artifacts. Typecheck, lint, build, formatting and 103 tests passed
before this benchmark.

All three runs below used 2,000,000 points, 5,000-point requests and eight writers
on the same machine described below. All A–G correctness checks passed in each
run. Throughput, row count and memory targets passed, but both latency targets
still failed.

| Measurement                                      | Earlier baseline | Diagnostics enabled | After removing diagnostics |
| ------------------------------------------------ | ---------------: | ------------------: | -------------------------: |
| Fresh insertion throughput (points/sec)          |        30,659.48 |           26,966.45 |                  29,988.61 |
| Latest p95 during writes (ms; target ≤50)        |           177.75 |              227.68 |                     185.27 |
| 30-day hourly bucket p95, idle (ms; target ≤150) |           174.00 |              305.99 |                     224.62 |
| API sampled peak RSS (MiB)                       |           242.34 |              226.31 |                     226.18 |

Run identifiers and UTC report timestamps (local evidence is retained under
`artifacts/acceptance-<run-id>/REPORT.md`, but is not required to read this summary):

- Baseline: `f62a9552-6d44-4bbf-bc8c-7ef115704bb5`,
  `2026-10-07T17:42:23.789Z`; database `metrics_benchmark_cooperative_03`.
- Diagnostics enabled: `0d2c8fb6-aa80-40d1-ba59-3c587ac24f5d`,
  `2026-10-07T18:07:57.168Z`; database `metrics_benchmark_latency_diagnostic_02`.
- Latest run, diagnostics removed: `5ab9f1f0-b4bc-4091-8d07-6479777296cf`,
  `2026-10-07T18:19:34.510Z`; database `metrics_benchmark_without_diagnostics_01`.
  Write duration: 66.69 seconds; idle latest p95: 5.44 ms; bucket p95 during
  writes: 573.40 ms; replay inserted zero new rows. No load errors were reported.

The temporary diagnostics monitored API/load-generator event-loop delay and
collected phase timing histograms for latest connection acquisition/query
round-trip and ingest hashing/validation/grouping. Latest connection management
was also changed from `pool.query()` to explicit acquire/query/release to separate
those timings. No SQL, indexes, pool sizes, processing chunk sizes or transaction
boundaries were changed. Summary telemetry used the existing IPC channel;
Markdown generation occurred after measurement, outside the timed workload.

Diagnostics are measurement tools, not optimizations: monitoring and recording
consume resources during the workload. Removing the changes recovered throughput
and latest latency near the earlier baseline. This supports the recent changes
contributing to the slowdown, but these sequential runs do not isolate their
exact cost or rule out cache, garbage-collection, disk or machine-load variation.
Bucket latency also recovered only partially. The diagnostic changes were
removed, restoring the earlier code; ordinary benchmark RSS sampling remains.
Any future diagnostics should be optional and evaluated with repeated enabled/
disabled comparisons. This experiment does not resolve the remaining latency
target failures.

### Earlier full-scale acceptance baseline

Acceptance execution: Pass. Performance: Fail.

The execution flag covers completed correctness checks, not all performance targets. This is an acceptance summary, not certification of every assignment deliverable.

Run: f62a9552-6d44-4bbf-bc8c-7ef115704bb5. Measured at (UTC): 2026-10-07T17:42:23.789Z.
Database: metrics\_benchmark\_cooperative\_03.
Points: 2000000; batch size: 5000; writers: 8; mode: cold.

#### Performance targets

| Checkpoint                     |              Actual | Target             | Result |
| ------------------------------ | ------------------: | ------------------ | ------ |
| Stored rows                    |             2000000 | Exactly 2,000,000  | Pass   |
| Fresh insertion throughput     | 30659.48 points/sec | ≥20,000 points/sec | Pass   |
| Latest p95 during fresh writes |           177.75 ms | ≤50 ms             | Fail   |
| 30-day hourly bucket p95, idle |           174.00 ms | ≤150 ms            | Fail   |
| API sampled peak RSS           |          242.34 MiB | <512 MiB           | Pass   |

#### Additional measurements

- Write duration: 65.23 seconds.
- Bucket p95 during fresh writes: 544.86 ms.
- Latest p95, idle: 5.38 ms.
- p95 degradation, latest / buckets: 3206.36% / 213.14%.
- Replay newly stored rows: 0; processed input: 179423.74 points/sec. Cached accepted responses are not new inserts.

#### Scenarios A–G

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

#### Machine

- cpu: Intel(R) Core(TM) i3-7020U CPU @ 2.30GHz.
- logicalCpus: 4.
- ramBytes: 12442411008.
- os: linux 6.8.0-51-generic.
- node: v20.18.0.
- postgres: PostgreSQL 17.11 (Debian 17.11-1.pgdg12+2) on x86\_64-pc-linux-gnu, compiled by gcc (Debian 12.2.0-14+deb12u1) 12.2.0, 64-bit.
- postgresJit: off.
- postgresInDocker: true.
- poolMax: 12.

#### Errors and pending verification

Acceptance error: None.
Load errors: \[\].

- Independently verified: 97 tests, typecheck, lint and build passed. Clean-clone reproduction remains unverified.
- Failed performance targets require investigation and a new measurement after optimization. Do not treat replay throughput as fresh insertion throughput.

Replay wall time for this latest run: **11.15 seconds**; no new points were stored. RSS is reported in MiB (1,048,576 bytes); 242.34 MiB is also below the PDF's literal 512 MB limit. The harness uses a 512 MiB threshold, so future results between 512 MB and 512 MiB need separate review.

### Previous measurements

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
| 17:02:53              | 75533ece-d3bd-4f16-8edf-396843e46261 | 2000000 |       34136.67 |  58.59 |    12.79 |              381.54 |             288.33 |  241.99 | Pass      |
| 17:32:28              | 5c28e0eb-699b-4294-8d21-0d71e376ff8b | 2000000 |       26289.45 |  76.08 |    20.07 |              214.40 |             196.11 |  228.75 | Pass      |
| 17:42:23              | f62a9552-6d44-4bbf-bc8c-7ef115704bb5 | 2000000 |       30659.48 |  65.23 |    11.15 |              177.75 |             174.00 |  242.34 | Pass      |

Small runs and the existing-data replay run do not demonstrate two-million-point cold-load targets. See the history for errors, workload scope and A–G details.

### Slow query, improvement and remaining misses

The original thirty-day bucket query grouped 250,000 points using per-row UTC date truncation and a hash aggregate. Its recorded production EXPLAIN took 1,891.626 ms, including 645.624 ms of JIT compilation. Sessions now disable JIT; the rewritten query aggregates clipped ranges per generated bucket using the required primary-key index, then looks up the value at max(timestamp). This preserves empty buckets, exact decimals and latest-by-time semantics without an extra production index.

With JIT already off on the same two-million-point data, interleaved before/after SQL execution times were 489.369/170.817, 361.223/194.626 and 363.211/174.719 ms. All eight series' before/after API responses and independent aggregate checks matched. These are three SQL samples, not HTTP p95. Complete raw before/after JSON EXPLAIN output is preserved in [measurement history](docs/measurement-history.md#rewrite-diagnostic).

Latest full-scale HTTP bucket p95 is 174.00 ms (target ≤150 ms). Latest HTTP p95 during writes is 177.75 ms versus 5.38 ms idle (target ≤50 ms during writes). Both cooperative runs improved measured latest latency versus the pre-optimization baseline but did not meet either latency budget. Synchronous ingest CPU work is a demonstrated contributor; SQL execution, pool waiting, remaining pg processing and load-client delays still require separate instrumentation.

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

The optional covering index was not adopted: it reduced bucket SQL p95 by 15.84% but lowered insert-kernel throughput by 24.69%, increased write duration by 32.78%, and consumed an additional 135.77 MiB index relation. The experiment below includes actual plans and measured costs.

### Remaining evidence limitations

The comparison measures the optional index present versus absent while keeping required primary keys and foreign keys. Disabling planner index access is not dropping an index, nor does it measure mandatory-index write cost. Physically dropped-index comparisons for measurements, series and request keys are recorded separately above as direct write-kernel evidence, not full API ingest comparisons. Matching lookup plans with/without the three business primary keys are now embedded above. Full API ingest comparisons with physically dropped indexes, clean-clone reproduction, and final submission/PR work remain unverified. Measured relation sizes exclude WAL and some relations; compliance with the PDF's rough 500 MB disk budget is not established. Retained experiment copies require additional disk space.

### Recorded strategy/index comparison and raw plans

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

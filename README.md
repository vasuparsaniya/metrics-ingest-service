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

All required API routes and business-schema migrations are implemented. Unit tests and real-Postgres API tests cover replay, concurrent duplicates, partial failure, late arrivals, and SIGTERM/restart. Runnable load, benchmark, A–G acceptance, and write-strategy/index-comparison scripts are now implemented and verified with small datasets. The full two-million-point measurements and evidence-driven optimization remain pending; no assignment throughput or latency target is claimed yet.

Work is on `feat/ingest`; the submission must include an open pull request into `main`.

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

### Readable run summary

Each acceptance run generates `REPORT.md` beside `acceptance.json`. Start with that Markdown file: it lists workload/machine identity, performance targets and actual measurements, A–G correctness results, pending independent checks, and links to JSON evidence. The terminal prints `markdownPath`, including for failed runs that reach report generation. Correctness success is separate from performance compliance; small/replay runs do not certify fresh two-million-point targets. New reports record the database name without credentials. Older JSON may show `Database: Not recorded`.

Generate the same summary for an existing acceptance JSON without rerunning any API or database work:

```bash
npm run report -- --input "artifacts/acceptance-RUN-ID/acceptance.json"
```

The generator never overwrites an existing `REPORT.md` or modifies JSON. Strategy/index comparisons and unit/E2E suites remain separate evidence; their completion is not inferred by the acceptance summary. Reports are generated after measurements, not during timed requests.

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
| G — Restart               | SIGTERM the application during the full load, restart, and resume/replay with the same generated data and keys. Verify exact final count, no duplicates, and no half-written batches. The current restart test covers a small interrupted batch, not this full-load scenario.                                 |

The generator persists a reproducible manifest containing series IDs, generation parameters, and exact expected per-series counts/sums; stable request keys derive from its run ID and batch index. Reuse it for replay and restart; creating new series would not test replay. Values are signed integer cents rendered as decimal strings, and expected sums use BigInt arithmetic. Points span thirty days deterministically, with unique millisecond timestamps within each series. At most one batch per writer is generated in memory.

429/503 and network failures have bounded retries with unchanged bodies/keys. Every attempt records its duration and status; replay throughput reports zero newly inserted points/sec rather than summing cached accepted counts. Reports also show processed-input throughput and replay wall time. Reader loops do not retry, so failed reads remain visible. Average verification follows the documented finite PostgreSQL NUMERIC division contract; count/sum/min/max/last and replay equality are independently checked without floating-point value arithmetic.

The managed **application process** RSS is sampled every 100 ms using its own `process.memoryUsage.rss()` over IPC (target: below 512 MB); Docker database/generator memory is not substituted. Measurement includes immediate and final samples while the child is alive. Reports include PID, source, sampling count, final-sample availability, and telemetry errors; missing telemetry is null, never invented zero memory. A terminated child retains its readings without waiting for a final sample it cannot send. Report CPU, RAM, PostgreSQL version, Docker usage, actual throughput, replay duration, row counts, both latency percentiles, and peak sampled RSS. Percentiles use nearest rank; successful and failed attempt durations/statuses are reported separately. Cold-load readers rotate across all eight series, run independently, and issue a request per category with a 100 ms pause. The range has 720 hourly buckets per series. A small run's metrics are verification evidence only. No full-scale measurements have been recorded yet.

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

| Index                                    | Purpose and write cost                                                                                          |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `series_pkey (id)`                       | Series identity, lookup, and referenced-key integrity. Updated on series creation, not each measurement insert. |
| `measurements_pkey (series_id, ts)`      | Required point identity, range scans, and backward latest lookup. Maintained on each new point.                 |
| `ingest_requests_pkey (idempotency_key)` | Atomic key claim and replay lookup. Maintained once per new batch request.                                      |
| `schema_migrations_pkey (name)`          | Migration bookkeeping only; not part of normal ingest traffic.                                                  |

The comparison report includes real lookup plans, bucket plans, relation/index sizes, insert timings with/without the optional covering index, and twenty measured query samples per indexed configuration. It also disables index/bitmap/index-only scans locally in a rolled-back read transaction to show a no-index-access plan without dropping correctness constraints. That diagnostic has a 30-second timeout; a timeout is recorded as a measured failure, not fabricated EXPLAIN output.

Strategy comparisons are **insert-kernel microbenchmarks** with identical point constraints, batch scope, eight writers, and ordered identities. They exclude HTTP validation, payload hashing, request records, and post-insert classification; their throughput is not the API's end-to-end throughput. The production load report supplies that measurement. Experiments run sequentially, so cache/order noise requires repeated runs before choosing an optimization.

Still required before submission: run the full two-million-point commands on the agreed database; paste the actual machine/results table and relevant raw plans here; identify a genuinely slow query and an evidence-backed improvement with both timings; diagnose target misses; and decide whether any measured optional index is worth its write/storage cost. Tooling availability is not a claim that these final measurement/optimization deliverables are complete.

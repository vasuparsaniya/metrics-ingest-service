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

All required API routes and business-schema migrations are implemented. Unit tests and real-Postgres API tests cover replay, concurrent duplicates, partial failure, late arrivals, and SIGTERM/restart. Full-volume load scripts, benchmark scenarios, index comparisons, and measured performance results are still pending; no throughput or latency target is claimed yet.

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

All endpoints, including probes, require the configured static bearer token. This is our current interpretation of the assignment's authentication requirement.

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

Use `npm run format` to format files. After building, `npm start` runs the compiled application. Ctrl+C or SIGTERM closes the HTTP server and connection pool through NestJS shutdown hooks.

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

## Assignment load test and benchmark — pending implementation

PDF sections 3, 4, 5, 6.1, and 8 require runnable load/benchmark scripts, not manual Postman requests or only correctness tests. **Those scripts are not implemented yet. There is currently no full-load or benchmark command to run.** `npm run test:e2e` runs real-database correctness tests, but does not establish the two-million-point performance targets. The smoke commands above do not satisfy that requirement either.

The scripts must eventually provide one documented command from a clean clone to a loaded database and a separate command to a benchmark result. They must generate data automatically and use the API; do not insert the load directly into PostgreSQL. Run against local Docker PostgreSQL, not a hosted database. Use a fresh, dedicated benchmark database so manual smoke-test points do not contaminate the exact final count; do not clear existing development data or its Docker volume.

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

The generator must persist a reproducible manifest containing series IDs, generation parameters, stable request keys, and exact expected per-series counts/sums. Reuse it for replay and restart; creating new series would not test replay. Decimal expected sums must not use JavaScript floating-point arithmetic. Retry 429 responses using `Retry-After` and the unchanged body/key; report retries and failures instead of silently discarding them. Keep C–E scenario data separate from A's counted dataset.

Monitor the **application process** RSS throughout the load (target: below 512 MB); Docker database memory is not a substitute. Report CPU, RAM, PostgreSQL version, Docker usage, actual throughput, replay duration, row counts, both latency percentiles, and peak RSS. No measurements have been recorded yet. Report misses honestly with diagnosed bottlenecks.

### Reconciliation SQL

Run this against the benchmark database and compare every row to the generator's expected per-series count/sum manifest. This query alone does not prove reconciliation until that manifest exists and is compared.

```sql
SELECT s.id::text AS series_id, s.name,
       count(m.series_id)::text AS point_count,
       sum(m.value)::text AS value_sum
FROM series s
LEFT JOIN measurements m ON m.series_id = s.id
GROUP BY s.id, s.name
ORDER BY s.id;
```

### Remaining benchmark evidence

The runnable benchmark must compare the chosen write strategy with at least one alternative; capture real `EXPLAIN (ANALYZE, BUFFERS)` output before/after indexing work; show a slow query improved with both timings; and measure ingest with and without the indexes being evaluated. Preserve the point-identity constraint in the correctness-preserving baseline and clearly describe any separate experimental schema. These results and actual script commands must be added here before submission. No fabricated results or placeholder npm commands are provided.

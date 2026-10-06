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

Initial application setup includes validated configuration, a PostgreSQL connection pool, static bearer-token authentication, health/readiness endpoints, and SQL migration tooling. Measurement ingestion, queries, stats, and load/benchmark scenarios are not implemented yet.

Implementation will take place on `feat/ingest`, with an open pull request into `main`.

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

## Initial endpoints

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

The runner applies numbered SQL files from `migrations/` and records checksums in `schema_migrations`. Repeating the command skips unchanged applied files. Business schema migrations will be added after the data contracts are decided; currently this command creates only migration tracking.

## Checks and tests

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run test:e2e
npm run build
```

`npm run check` combines typecheck, lint, unit tests, end-to-end tests, and build. Start PostgreSQL first for end-to-end tests and set `TEST_DATABASE_URL` in `.env`. Tests query the real test database and verify authentication, readiness, and liveness during database connectivity failure. Configuration unit tests do not use a database. The four required ingestion/restart end-to-end scenarios will be added with those features.

Use `npm run format` to format files. After building, `npm start` runs the compiled application. Ctrl+C or SIGTERM closes the HTTP server and connection pool through NestJS shutdown hooks.

The initial pool limit is 12, with bounded connection and statement timeouts. Its final size and behavior under load must be measured before claiming it meets assignment targets.

## Planned documentation

As implementation progresses, this README will include setup and migration commands, API contracts, load and benchmark commands, acceptance scenario instructions, measured performance results, index analysis, reconciliation SQL, and documented assumptions.

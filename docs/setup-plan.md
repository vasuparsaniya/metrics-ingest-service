# Initial setup plan

The user approved NestJS 11, strict TypeScript, PostgreSQL, direct SQL through `pg`, Jest/Supertest, and feature-oriented folders. PostgreSQL runs locally in `docker-compose.yml`; Node runs on the host.

1. Add package scripts, strict compiler configuration, lint/format settings, and ignored local environment files.
2. Validate environment variables and create a single bounded PostgreSQL pool with graceful shutdown.
3. Add bearer-token authentication and health/readiness routes. All routes require the token; document this interpretation.
4. Add local PostgreSQL with persistent storage and a separate test database.
5. Add a checksummed transactional SQL migration runner. Defer business tables until data contracts are decided.
6. Verify configuration unit tests, real-Postgres API tests, migration rerun, typecheck, lint, formatting, and build.
7. Update README with working commands and current scope. Load/benchmark scripts and scenarios A–G belong to later implementation.

Pool size 12 is an initial setting to benchmark against eight writers plus concurrent readers, not yet a performance justification.

## Setup verification

Completed on 6 October 2026 with Node.js 20.18.0, NestJS 11.2.7, and PostgreSQL 17.11 in Docker.

- Typecheck, lint, formatting, and build passed.
- Nine configuration unit tests and three HTTP end-to-end tests passed.
- The end-to-end tests queried `metrics_test` in real PostgreSQL.
- Migration tracking initialized successfully; rerunning the command succeeded.
- The compiled application's liveness and readiness routes returned 200 with the bearer token.
- The application was stopped after the smoke check; PostgreSQL remains running on port 5433 because port 5432 was already occupied. The user confirmed keeping the separate Docker server on port 5433.
- The npm registry connection reset in this environment, so installation used `https://registry.yarnpkg.com` without changing global npm configuration.
- The runtime dependency audit reported zero vulnerabilities. The initial full audit flagged development-tool dependencies; those findings still need review.

These checks verify the initial setup, not ingestion correctness or assignment performance targets.

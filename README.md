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

Repository initialized. Application setup and implementation have not started.

Implementation will take place on `feat/ingest`, with an open pull request into `main`.

## Planned documentation

As implementation progresses, this README will include setup and migration commands, API contracts, load and benchmark commands, acceptance scenario instructions, measured performance results, index analysis, reconciliation SQL, and documented assumptions.

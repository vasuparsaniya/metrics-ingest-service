# Migrations and API implementation

Scope: implement the agreed database schema and all seven required routes. Changes were initially kept uncommitted; Vasu subsequently authorized committing this implementation. Full-volume load scripts, benchmark comparisons, and acceptance-scenario automation remain a later stage.

1. Create series, measurements, and ingest-request migrations with essential constraints and only primary-key indexes.
2. Add pure decimal, ID, microsecond timestamp, row, and request-fingerprint validation. Use PostgreSQL's storage bounds rather than the declined application digit/year caps.
3. Add database transaction helpers and predictable database error responses. Preserve reader capacity by limiting active ingest operations relative to the configured pool, with no waiting application queue.
4. Implement series creation and ingestion. Claim request keys before measurement locks; insert unique candidates in identity order; classify skipped identities in a subsequent READ COMMITTED statement. Store results and measurements atomically.
5. Implement UTC bucket SQL, latest, and consistent-snapshot stats. Preserve decimal strings and microsecond timestamp output.
6. Add unit and real-Postgres API tests, including concurrent duplicates, partial failure, late arrivals, and actual process interruption/restart. Apply migrations and run checks. The full-volume acceptance harness remains a later stage.
7. Document implemented contracts, commands, and unmeasured performance limitations.

Implementation status: all seven steps above are complete. Verification passed: 34 unit tests, 18 real-PostgreSQL end-to-end tests, TypeScript checking, lint, production build, formatting, and repeatable migrations against both databases. End-to-end coverage includes actual interruption/restart and PostgreSQL's upper timestamp boundary. Full-volume performance measurements and the standalone acceptance harness are still pending.

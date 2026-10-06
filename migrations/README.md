# SQL migrations

Add schema migrations here after the measurement contracts are decided. Name each file with a sortable numeric prefix, such as `001_create_series.sql`.

Run `npm run db:migrate` from the project root. The runner records file names and SHA-256 checksums in `schema_migrations`, skips unchanged applied files, and rejects edits to applied migrations. Add a new migration instead of editing an applied one.

All pending files and their tracking entries commit together in one transaction. A transaction-scoped advisory lock serializes migration runners. Files must contain transactional SQL and must not include their own `BEGIN` or `COMMIT`, or operations such as `CREATE INDEX CONCURRENTLY` that cannot run in a transaction.

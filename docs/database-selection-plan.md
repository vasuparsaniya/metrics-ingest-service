# Load database selection

Approved design: use DATABASE_URL by default; --database overrides only its database name. Ignore the obsolete BENCHMARK_DATABASE_URL variable. Keep credentials, host, port and query options unchanged. Validate explicit names as ASCII SQL identifiers of at most 63 bytes. Never delete data; cold loads refuse nonempty measurements.

The default connects directly to the configured existing database and applies migrations, without needing access to the postgres administrative database. Explicit local database overrides may create a missing database. Acceptance case/restart databases remain isolated; comparison tables remain experimental copies.

Implementation plan (inline execution; no commit authorized):

- [x] Add selection/argument regression tests and observe failures.
- [x] Update shared options, URL selection and database preparation; thread options through all four commands. Forward setup arguments.
- [x] Document reviewer defaults, local override and replay commands.
- [x] Run type checking, lint, tests, formatting and a small isolated real-database load. Do not load the user's main database during verification.

Verification: npm run check passed (48 unit tests, 20 real-database/child-process tests, typecheck, lint, build); formatting and git diff checks passed. Explicit --database metrics_benchmark_selection_20261007 created/migrated a local database and inserted exactly 5,000 points. A subsequent replay using DATABASE_URL with no --database kept exactly 5,000 rows and verified unchanged aggregates. Manifest: artifacts/0a32cec0-b6ff-461d-b169-4f1c789e292f/manifest.json. The test database and ignored reports are retained. Main metrics data was not loaded or deleted. No full-scale measurement or commit was performed.

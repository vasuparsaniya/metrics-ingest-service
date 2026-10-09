# Storage and WAL measurement plan

Approved: tooling only now; do not load data or run database tests until the
separate clean-clone session finishes. No production API/schema changes.

## Method and safety

Add `storage:measure`, reusing the existing cold load, reconciliation and managed
API lifecycle. Require an explicit local non-main database and
`--confirm-exclusive-cluster`. The flag is an operator attestation, not a lock
against external sessions. Require fresh empty application tables, no unrelated
user tables, and administrative WAL-read permission before ingestion. Never
delete data, force CHECKPOINT/VACUUM, change PostgreSQL settings or grant roles.

Capture database bytes; each table's main-fork, all table forks/TOAST, index and
total relation sizes; cluster WAL retained bytes and insert LSN. Before starts
after migrations/API startup, before series generation. After ends following the
existing load and read-only reconciliation. Compute WAL generated with
pg_wal_lsn_diff; database and retained-WAL deltas independently. Detect server
restart and reject negative LSN differences. WAL is cluster-wide and background
maintenance can contribute even without other user writes. Snapshot sizes are
not peak usage; database plus cluster-retained WAL is not per-database WAL
attribution or total cluster footprint. Rough 500 MB guidance is not a hard gate.

Preserve a before artifact, then unique JSON/REPORT.md on successful or failed
loads whenever after collection succeeds. On collection failure, record a
partial report instead of zeros, fail the command and retain evidence/data.

## Implementation checklist

- [x] Add failing pure tests in `src/validation/storage-measurement.spec.ts` for
      exact byte arithmetic, missing-after/failed-load reports, options and guards.
- [x] Add `scripts/load/storage.ts`: SQL snapshots, pure summaries and Markdown.
- [x] Add `scripts/storage.ts`: argument parsing, safe fresh DB checks, existing
      load orchestration, artifact persistence and cleanup; add package command.
- [x] Document command, privileges, isolation, snapshot scope and limitations in
      README, with measurement explicitly pending rather than invented numbers.
- [x] Run unit tests, typecheck, lint, build and touched-file formatting only.
      Do not execute `storage:measure` or real PostgreSQL tests in this session.

Sources: PostgreSQL 17 system administration functions
https://www.postgresql.org/docs/17/functions-admin.html
Use only core PostgreSQL SQL for portability; no Linux /proc, shell du or Docker
inspection needed for storage capture. No commit/push requested.

Verification: 171 pure unit tests passed; typecheck, lint and build passed.
No database load, storage SQL execution or integration tests were run. Real
PostgreSQL validation and actual measurements remain pending coordination with
the clean-clone session. No storage results were claimed at implementation time.

## Subsequent user-executed verification

On 2026-10-09 the user ran two full two-million-point measurements, after the
clean-clone session finished. Both captured storage successfully and passed
exact row/sum/aggregate verification. Existing-cluster evidence:
`storage-5591c6b1-9d4d-419e-ae5b-df4d4d04ba47`, 01:39:12.508 UTC.
Fresh-container/new-volume evidence:
`storage-9da8e27c-0f31-4bb1-affa-a83835e807b1`, 01:46:49.916 UTC.
README records endpoint sizes, WAL generated versus retained, commands and
limitations. The fresh database plus cluster-retained WAL was 617,404,083 bytes,
above the rough 500 MB guidance; total cluster files and peak usage remain outside
the measurement. No tuning, cleanup or production schema changes were made.

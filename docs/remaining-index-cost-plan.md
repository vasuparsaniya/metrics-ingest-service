# Remaining Index Cost Implementation Plan

> Execute inline with executing-plans; no agents, worktree changes or commits.

**Goal:** Reproducible synthetic write-cost evidence for series and request keys.

**Architecture:** Guarded local CLI plus a direct SQL comparison module; create
four unique isolated tables, compare identical workloads with physically removed
primary keys, validate stored payloads and catalog evidence, emit JSON/Markdown.

**Tech Stack:** Existing TypeScript, pg, Jest and PostgreSQL.

- [x] Add failing tests in `src/validation/remaining-index-cost.spec.ts` for
      rejecting unrelated identifiers, identical INSERT SQL and workload bounds.
- [x] Implement `scripts/load/remaining-index-cost.ts`: LIKE copies with checks
      and identities, PK removal without CASCADE, 5,000-row batches/eight workers,
      indexed-first timing, exact payload/key validation and actual index evidence.
- [x] Add `scripts/remaining-index-cost.ts` and `index:cost:remaining` command.
      Require explicit non-main local existing DB; default 100,000 rows, bounded
      `--points` override; report direct SQL pool=8, no API process.
- [x] Run targeted tests and a 10,000-row smoke in
      `metrics_benchmark_covering_fresh_02`; verify all four tables and reports.
- [x] Run `npm run check` before measurement. Run the default full comparison
      without concurrent heavy checks, inspect results, and embed them in README.

Expected: deterministic counts/payloads match and catalog shows exactly one
index vs zero for each pair. Failures propagate after workers drain. Reports
remain ignored; experimental tables are retained. Single sequential trials are
observational, not API acceptance or a reason to remove required indexes.

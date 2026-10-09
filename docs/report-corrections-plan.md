# Benchmark report corrections

Evidence: clean clone at 50a072c has replay-mode acceptance A; its renderer still
unconditionally labels reads as fresh writes. Both RSS monitor and Markdown
threshold use 536,870,912 bytes while the PDF says 512 MB (512,000,000 bytes).

Approved changes: use recorded cold/replay/resume mode in read labels, retaining
Not measured for non-cold full-scale compliance. Centralize literal RSS bytes
for collector and renderer while retaining MiB as a labelled display unit.
No ingest SQL, API, WAL configuration, workloads or historical JSON edits.

- [x] Reproduce labels and 512 MB/512 MiB boundary with failing pure unit tests.
- [x] Update `scripts/load/report.ts` mode labels and shared RSS limit.
- [x] Update `scripts/load/rss.ts` literal limit and pure threshold predicate;
      test missing telemetry and exact-boundary failure without a database.
- [x] Run typecheck/lint/unit tests/build; document fixes in README, retaining
      historical threshold caveats. Existing artifact regeneration is opt-in.

Use systematic-debugging: trace constants/labels, test each cause, then apply
minimal fixes. No performance improvement claim; no benchmark needs rerunning
solely to verify these pure reporting changes. Storage commit is separate.

Verification: four added renderer regression cases failed before the fix and
passed afterward. The RSS predicate verifies 511,999,999 passes; 512,000,000 and
520,000,000 fail; missing telemetry stays null and telemetry errors fail.
All 176 unit plus 26 real-PostgreSQL/child-process tests passed (202 total), along
with typecheck, lint and build. No full benchmark or artifact regeneration ran.

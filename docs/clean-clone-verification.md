# Clean-clone verification summary

Completed 2026-10-09T01:04:55.448186Z. Reproducibility/correctness **PASS**;
full performance compliance **FAIL**. This records an existing verification,
not a new run or a claim that every submission requirement is complete.

## Snapshot and isolation

GitHub clone checked out exactly
`50a072c40e60e306840f919489129f02b4135874` on a detached HEAD. The remote
advertised that commit on `feat/ingest` and PR 1. Thus this verified GitHub
availability, not just a local committed snapshot.

Verification directory was `metric-ingest-service-copy` beside the main repo.
Docker project: `metrics_clean_clone_50a072c`; fresh volume:
`metrics_clean_clone_50a072c_postgres_data`; host port: 55433. Databases:
`metrics_clean_load` for load/diagnostics and `metrics_test` for integration tests.
No original repository/database edits, commits, pushes, PR changes or resource
cleanup were performed. The user confirmed no other timed/heavy work was active.
Only owned API children stopped; resources remain for inspection.

Machine: Intel i3-7020U 2.30 GHz, four logical CPUs, 12,442,415,104 RAM bytes,
Linux 6.8.0-51, Node 20.18.0, PostgreSQL 17.11 in Docker; pool 12, UTC, JIT off.

## Commands and correctness

Environment/ports/Compose project were overridden only for isolation. Following
the committed README, these completed successfully:

```bash
npm ci
npm run db:up
npm run db:migrate
npm run db:migrate:test
npm run typecheck
npm run lint
npm test -- --runInBand
npm run test:e2e
npm run build
npm run format:check
npm run load:setup -- --database metrics_clean_load
```

Unit tests: 165 in 15 suites. Real PostgreSQL/child-process tests: 26 in four
suites. Total at this snapshot: **191**. Subsequent replay, benchmark, acceptance,
compare, primary-index cost, remaining-index cost and lookup-plan commands all
ran successfully with the original full manifest. A successful command collecting
measurements is not necessarily performance compliance.

Dataset: `40137ceb-2e29-46ae-a4db-97c926e013fa`. Cold workload: 2,000,000 points,
400 batches of 5,000, eight concurrent writers. Each series stored 250,000 points.
Independent generator/SQL reconciliation matched all sums:

| Series | Exact sum |
| ------ | --------: |
| 1      |   -621.25 |
| 2      |   -622.50 |
| 3      |   -623.75 |
| 4      |   -625.00 |
| 5      |   -626.25 |
| 6      |   -627.50 |
| 7      |   -628.75 |
| 8      |   -630.00 |

Total: **-5005.00**. Replay inserted zero new points; all bucket aggregates stayed
unchanged. Cold writer interval: 44.83 seconds; standalone replay: 17.59 seconds.
These are writer durations, not full setup/reconciliation command wall times.

A/B counts and replay, C concurrent deduplication, D partial success, E late data,
F read availability and G POSIX SIGTERM recovery passed. D accepted 4,996,
counted one duplicate and rejected indexes 4/5/6 with explicit reasons. G observed
the target INSERT waiting mid-batch, retained 35,000 complete rows after SIGTERM,
retained no half-written target batch/request, then resumed to 2,000,000 and
passed unchanged replay. Its expected interrupted 429 remained in the evidence.

Acceptance run `80cffc1f-1e51-4e66-830c-6ee23cfe6f3e` reused the existing manifest,
so acceptance A/B were replays, not fresh-write evidence. Original cold JSON
supplies A/F, and the standalone benchmark supplies the matching idle values.

## Benchmarks and limitations

| Check                          | Target             |                 Actual | Status |
| ------------------------------ | ------------------ | ---------------------: | ------ |
| Final rows                     | Exactly 2,000,000  |              2,000,000 | Pass   |
| Cold throughput                | ≥20,000 points/sec |              44,615.49 | Pass   |
| Latest during cold writes p95  | ≤50 ms             |  91.36 ms, 318 samples | Fail   |
| Idle 30-day hourly buckets p95 | ≤150 ms            | 180.57 ms, 100 samples | Fail   |
| Sampled API RSS                | <512,000,000 bytes |      249,516,032 bytes | Pass   |

During-write bucket p95: 404.70 ms (148 samples); idle latest p95: 5.31 ms.
Cold latest/bucket read failures: zero. RSS samples every 100 ms establish
sampled peak, not every instantaneous peak. All retained load/replay/resume
peaks were independently below the literal MB limit; highest was 249,643,008
bytes during restart resume.

Direct write comparisons reconciled exactly: UNNEST 70,303.19 versus VALUES
52,269.88 points/sec, covering-index UNNEST 64,060.24. Measurements PK retained
98,080.77 versus physically absent 112,041.92 points/sec. These exclude HTTP
validation/hashing/request bookkeeping. Synthetic key comparisons used 100,000
rows each. Query rewrite direct SQL p95 was 399.18 ms before versus 150.84 ms
after. Index-disabled bucket execution timed out at 30,001.35 ms: a measured
failure, not a completed plan. All lookup pairs returned identical results.

No new event-loop, pool-wait or CPU instrumentation ran; these values do not
establish an exact cause of latency misses. Retained experiment copies greatly
increase disk usage and cannot represent single-load storage. Both installations
reported 41 npm audit vulnerabilities; no dependency fixes were applied. That
finding requires separate review, not speculative lockfile changes.

## Source evidence and newer changes

Original full verification record remains at
`../metric-ingest-service-copy/CLEAN-CLONE-VERIFICATION.md`; logs and independent
audits are under that copy's `artifacts/clean-clone-verification/`. Key artifacts:

- Cold JSON: `artifacts/40137ceb-2e29-46ae-a4db-97c926e013fa/cold-1791507049500-e49e12f6-ed7d-490c-8aaf-9bb604d6927d.json`.
- Benchmark: same dataset directory,
  `benchmark-1791507204103-3e9383c3-d79b-43ee-ad6a-fbd2726bd7dd.json`.
- Acceptance: `artifacts/acceptance-80cffc1f-1e51-4e66-830c-6ee23cfe6f3e/REPORT.md`.

Those paths belong to the verification copy, not this repository's artifacts.
They are intentionally text references, not broken links in a clean clone.
This summary carries essential evidence without committing generated artifacts.

Later commit `636d10f` adds storage tooling and records two user-executed full
loads. Fresh-cluster database plus retained WAL: 617.40 MB, above rough guidance.
`60eb96d` fixes replay/resume read labels and enforces the literal 512,000,000-byte
RSS budget. Historical artifacts are unchanged. Local checks at the newer
revision passed 176 unit + 26 integration tests (202), typecheck/lint/build;
**a new clean-clone verification of those commits has not been performed**.

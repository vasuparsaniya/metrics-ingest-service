# Optional API CPU profiling

Approved scope: add `--profile-api` to `npm run load` only. Ordinary load and
acceptance runs stay unprofiled. Use Node inspector Session locally inside the
benchmark-owned child; no inspector port, dependency or API endpoint is exposed.

The optional preload starts profiling before API bootstrap. The load script
requests an explicit profiler stop and waits for a matching IPC acknowledgement
before normal child shutdown. The child writes a unique `.cpuprofile` under
artifacts. Failures are reported rather than claiming a profile was saved.
Profiling includes API startup, workload and reconciliation, not just fresh-write
request handlers. Profiled timings are diagnostic, never final compliance data.

- [x] Add opt-in parsing and reject the flag in non-load scripts.
- [x] Add benchmark-only profiler preload and bounded IPC stop handshake.
- [x] Thread a unique output path through the owned API launcher and load command.
- [x] Test option defaults/rejection, real-child profile saving and cleanup.
- [x] Run checks: 85 unit tests and 25 integration/child-process tests passed
      (110 total), as did typecheck, lint and build. Run a 40,000-point profiling
      smoke load in `metrics_benchmark_cpu_profile_smoke_01`: exactly 40,000
      stored rows, no load errors, diagnostic-only report and saved profile.
      No full acceptance was launched.

No changes to business logic, SQL, schema or validation. No commit/push requested.

Smoke evidence (ignored local artifacts): manifest run
`fb3ec636-be79-4f19-870a-d00fe0497814`, profile
`artifacts/api-d6bfecb0-3997-4de5-b91b-60e360a526f6.cpuprofile`.
The profile covers the child API, not the parent. The ordinary RSS sampler remains
unchanged. Additional profiling CPU/memory overhead must not be interpreted as
an application performance regression or final target measurement.

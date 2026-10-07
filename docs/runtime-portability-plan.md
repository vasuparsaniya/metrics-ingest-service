# Runtime measurement portability

Approved change: replace Linux `/proc` RSS polling with API-child self-measurement over Node IPC, launch npm through its JavaScript CLI, and document cross-platform execution and restart semantics. No database, API contract, dependency, commit, or full-volume load changes are authorized here.

Implementation steps:

1. Add a strictly typed benchmark-only preload module at `src/benchmark/rss-preload.ts`. Compile with the existing build. It starts/stops a 100 ms `process.memoryUsage.rss()` sampler only when the parent requests it; readings include the managed process PID and measurement ID. It is never imported by the ordinary API bootstrap.
2. Add `scripts/load/rss.ts` for request-scoped IPC measurement. Narrow message types, reject wrong PID/measurement IDs, include an immediate/final sample, retain unavailable/error reporting, detach listeners on completion, and handle process exit without waiting forever.
3. Update `scripts/load/runtime.ts` to start the compiled API with the optional preload and one IPC channel. Update loader/restart callers to pass the managed child, not its PID alone. Keep the application as the measured process and keep timing calculations unchanged.
4. Update `scripts/setup-load.ts` to launch the npm JavaScript CLI with `process.execPath` and separate arguments, avoiding shell-dependent `.cmd` launching and paths-with-spaces issues.
5. Record actual platform and termination semantics in restart reports. Linux/macOS use SIGTERM; native Windows tests forced termination plus transactional rollback/replay, not POSIX graceful shutdown. Keep fallback SIGKILL distinguished from the requested signal.
6. Test narrowing, missing IPC, cleanup on exit, real child RSS readings, npm invocation paths, and platform semantics. Run `npm run check`, formatting, and a small real-database acceptance verification. Do not claim Windows/macOS were tested on this Linux environment; no CI workflow is published or executed.
7. Update README examples to configure the benchmark URL in `.env` and use identical npm commands in Bash, PowerShell, and CMD. Retain the requirement to verify PDF scenario G on a POSIX environment, such as WSL2 for Windows users.

Alternatives considered: OS-specific `ps`/PowerShell commands need multiple parsers and shell handling; putting all application measurements in Docker changes the measured deployment environment. Native self-measurement over IPC avoids both without adding a service or endpoint. Node documents RSS and Windows termination behavior in its [process](https://nodejs.org/api/process.html#processmemoryusagerss) and [child-process](https://nodejs.org/api/child_process.html#subprocesskillsignal) references.

## Completed verification

Implemented all steps. `npm run check` passed 48 unit tests and 20 end-to-end tests, including real child-process telemetry, PostgreSQL, and interrupted-batch restart. Typecheck, lint, production build, and formatting passed. The APIs and business schema were unchanged.

A 5,000-point real-API cold report recorded eight samples, a final sample, no telemetry errors, and peak RSS of 108,716,032 bytes using the API child's own RSS function. This is small-run verification, not a two-million-point memory/performance claim. The initial acceptance attempt encountered a concurrent build deleting `dist`; running acceptance sequentially after the build passed. Run builds/checks and benchmarks separately, as the README requires.

The successful acceptance report is `artifacts/acceptance-1625ae7b-aa2d-4a2b-9f28-eeebba4e065c/acceptance.json`. It verifies replay, C–E, and POSIX interruption/restart with the new preload/IPC measurement path on Linux. Existing data/artifacts were retained. Windows/macOS arguments and report semantics have unit coverage, but those OSes were not executed here. No new commit or full-volume load was made.

# UTC timestamp normalization implementation plan

**Goal:** Avoid converting exact microseconds back into calendar fields for
ordinary validated UTC timestamps, without changing validation or stored values.

**Approved design:** Preserve the existing regex, calendar/offset validation,
microsecond arithmetic and native PostgreSQL bounds. After those checks, reuse
input fields only for four-digit positive years and a literal Z timezone.
Construct SQL text from the validated input with a six-digit fraction. All other
inputs use the existing sqlTimestamp formatter. No cache, Date conversion, SQL
change, dependency or transaction change is introduced.

**Alternatives:** Leaving the formatter unchanged preserves its CPU cost;
caching timestamps adds memory without helping mostly unique input timestamps.
The narrow UTC fast path avoids both costs while retaining the general fallback.

## Implementation and verification

- [x] Add dedicated `src/validation/timestamp.spec.ts` tests comparing ordinary
      UTC output with equivalent +00:00 fallback output, all fractional lengths,
      epoch/leap/year edges, and invalid dates. Assert that an ordinary UTC input
      does not invoke String.prototype.padStart after validation (red on baseline).
- [x] In `src/validation/timestamp.ts`, after native bounds validation, choose
      `value.slice(0, 10) + ' ' + value.slice(11, 19) + '.' +
(match[7] ?? '').padEnd(6, '0') + '+00'` only when zone is Z,
      year is positive, and the year field has exactly four digits.
- [x] Run dedicated tests, then `npm run check` and formatting checks. Existing
      PostgreSQL integration tests verify microsecond and expanded-year storage.
- [x] Record implementation in README without claiming a measured gain.
- [x] The user ran unprofiled full acceptance in a fresh database; compare with run
      46e89655 (46,781.87 points/sec, latest p95 85.62 ms, bucket p95 151.96 ms).

Profile evidence: api-bce2fff1 sampled timestamp self time 6.98% and pad self time
2.82% across the entire session, not an isolated latest-request latency cause.
Full acceptance and commits are not launched automatically for this change.

Verification: the baseline failed the no-reformat regression (seven padStart
calls versus zero expected); the other 27 dedicated cases passed. With the fast
path, all 121 unit and 26 PostgreSQL/child-process tests passed (147 total), as
did typecheck, lint and build. Formatting and git diff whitespace checks passed.

## Full-scale measurement and decision

Run f2ac9857-d440-4412-afbc-90e2add25e68, UTC 2026-10-08T02:18:13.571Z,
database metrics_benchmark_timestamp_fast_path_01, 2,000,000 points, 5,000-point
requests, eight writers, pool 12, JIT off:

- Throughput: 51,463.39 points/sec, versus 46,781.87 (+10.0%).
- Latest p95 during writes: 72.75 ms, versus 85.62 (-15.0%); ≤50 ms target failed.
- Idle 30-day hourly bucket p95: 152.01 ms, versus 151.96; ≤150 ms target failed.
- Write duration: 38.86 seconds; API sampled peak RSS: 239.34 MiB.
- Bucket p95 during writes: 389.37 ms; idle latest p95: 3.43 ms.
- Exactly 2,000,000 rows, zero replay inserts, all A–G checks and POSIX SIGTERM
  recovery passed; no acceptance/load errors.

User decision: keep the fast path. Repeat runs are needed to confirm consistency;
unchanged bucket SQL and essentially unchanged idle latency show that the bucket
budget still needs separate investigation. The remaining profile evidence points
to canonical JSON construction and GC as candidates for the next investigation,
not proof that either accounts for the entire latest-request latency.

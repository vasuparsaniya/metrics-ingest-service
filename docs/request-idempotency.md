# Ingest request idempotency

This document records the agreed HTTP request behavior for `POST /v1/ingest`. It is a design contract; implementation and concurrency tests are still pending. Column types and constraints are documented in [database-design.md](database-design.md).

## Assignment requirement and our interpretation

The PDF requires an Idempotency-Key header and correct replay, concurrent duplicate handling, and restart behavior. It does not prescribe hashing, saved responses, key bounds, or retention. The rules below are our agreed interpretation.

GET endpoints do not use these keys or saved responses; they query current database state.

## Header validation

- Require exactly one `Idempotency-Key` header value.
- Accept 1–128 characters in the printable ASCII range `!` through `~` (character codes 33–126). Reject spaces, control characters, and non-ASCII characters.
- Do not trim or silently alter keys. Detect repeated header occurrences at the HTTP boundary instead of relying only on a potentially combined header string.
- Missing, empty, repeated, or invalid key: HTTP 400 Bad Request before processing measurements.
- Keys are unique across this service, which uses one static bearer token rather than separate tenants.

## Request fingerprint

Generate one SHA-256 fingerprint of a deterministic representation of the complete request body. Ignore JSON whitespace and object-property order. Preserve point array order because rejection indexes and first-occurrence duplicate precedence depend on it.

Reordering points while reusing a key is a content mismatch. Whether equivalent numeric or timestamp spellings share a fingerprint remains open.

The application generates the hash; the client does not supply it. Do not scan stored measurements to compare request bodies or store the original measurement payload for this purpose.

## Processing and replay

| Situation                           | Outcome                                                                             |
| ----------------------------------- | ----------------------------------------------------------------------------------- |
| New key                             | Process the batch and save its response                                             |
| Existing key, matching fingerprint  | Return the original saved response without processing points again                  |
| Existing key, different fingerprint | Return HTTP 409 Conflict                                                            |
| Concurrent matching requests        | One processes; the other returns the committed response, subject to bounded waiting |

Point-level duplicate and conflict rules remain as described in [database-design.md](database-design.md). Every input row must receive exactly one accepted, duplicate, or rejected outcome.

## Saved response

Save the complete `{ accepted, duplicates, rejected: [{ index, reason }] }` response body, not HTTP headers or the original measurement payload. Return its JSON meaning on replay; original whitespace and object-property order are not preserved.

For example, a retry can return the original `accepted: 5000` even though the retry inserts no additional points. The response describes the original operation, not the current row count. Rejection details are replayed too.

## Transaction and concurrency

Claim the new key, insert valid measurements, and save the complete response in the same batch transaction. Commit before returning success. Rollback leaves neither the request record nor that transaction's measurement inserts.

PostgreSQL's unique constraint coordinates concurrent claims. A second claim can wait for the first transaction even when another pool connection is available. If the first commits, the second reads and compares the saved record; if it rolls back, the second can claim the key.

An uncommitted request record is not visible to other transactions. We do not use a separately committed PROCESSING state, polling worker, or stale-state recovery job. The temporarily empty response must be populated before commit and must never be returned as a successful replay.

Bounded waiting, admission limits, retryable timeout responses, and consistent measurement insertion order still need implementation and real-Postgres tests. A database wait alone does not establish a deadlock; the complete locking strategy must be tested.

## Retention

Keep request records without automatic expiry for the assignment. This preserves original-response replay across later retries and application restarts.

Removing a record would allow that key to be processed again. Point uniqueness would still prevent duplicate measurements, but the response counts could change. No cleanup index or expiry job is needed for this scope.

## Remaining decisions

- Exact canonicalization rules for equivalent numeric and timestamp spellings, including invalid rows.
- Wait-time limits, admission limits, and retryable timeout response details.

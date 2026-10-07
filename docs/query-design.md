# Bucketed query contract

This document records implemented behavior for `GET /v1/series/:id/points?from&to&bucket=` and the latest-point endpoint. Performance measurements are pending.

## Assignment requirements

The PDF requires range queries for a series with bucket sizes `1m`, `1h`, and `1d`. Each bucket returns count, sum, min, max, avg, and last. Aggregates must remain correct after out-of-order and late arrivals. The performance target is a 30-day hourly query over the full dataset with p95 latency at most 150 ms; query latency must also be measured during ingestion.

The PDF does not specify boundary inclusivity, bucket alignment, or bucket-label representation. The rules below are our agreed assumptions and must be summarized in the final README.

## Range boundaries

Include `from` and exclude `to`: `from <= ts AND ts < to`. Adjacent ranges share a boundary without counting a point at that boundary twice.

Apply this filter before aggregation. A bucket label never expands the requested range. Reject invalid ranges and unsupported bucket values. The proposed arbitrary 10,000-bucket cap was not adopted.

## UTC bucket alignment

| Bucket | Alignment                                                             | Example point → bucket start                    |
| ------ | --------------------------------------------------------------------- | ----------------------------------------------- |
| `1m`   | Start of each UTC minute; seconds and fractional seconds zero         | `10:15:42Z` → `10:15:00Z`                       |
| `1h`   | Start of each UTC hour; minutes, seconds, and fractional seconds zero | `10:15:42Z` → `10:00:00Z`                       |
| `1d`   | Midnight at the start of each UTC calendar day                        | `2026-10-07T10:15:42Z` → `2026-10-07T00:00:00Z` |

Buckets align to UTC clock/calendar boundaries, not to the request's `from`. Return bucket-start timestamps in UTC.

For `from=10:15Z`, `to=11:00Z`, and `bucket=1h`, points from 10:15 inclusive through 11:00 exclusive contribute to the bucket labeled 10:00Z. Points before 10:15 and at 11:00 are excluded. This is a partial hourly bucket.

## Reasons

- Fixed alignment gives the same minute/hour/day boundaries across queries with different start times, making dashboard intervals consistent.
- UTC avoids daylight-saving transitions; UTC minute, hour, and day buckets have predictable durations.
- Filtering first preserves the requested range, including partial first and last buckets. Aligned labels do not imply full-bucket coverage or identical results for different ranges.
- Half-open ranges prevent boundary overlap when querying adjacent periods.

## Aggregation location

PostgreSQL computes aggregates using SQL. NestJS returns the results; it must not fetch raw measurements and aggregate them in application code. NUMERIC supports exact stored decimals and sums, but repeating averages still require an explicit output contract.

## Empty buckets

Emit aligned buckets that overlap the requested range, including intervals containing no measurements. For an empty bucket, return:

```json
{
  "count": 0,
  "sum": null,
  "min": null,
  "max": null,
  "avg": null,
  "last": null
}
```

Count zero is the exact number of measurements present, not an invented measurement value. Aggregate values are null to distinguish missing data from actual zero-valued measurements or a real sum of zero. Emitting empty buckets lets dashboards show gaps. The implemented UTC timestamp field is `bucketStart`.

The PDF states that nonexistent measurements are null, never zero, but does not explicitly require emitting empty buckets or define their count representation. This is our agreed interpretation.

## Last point in a bucket

For a non-empty bucket, `last` is an object containing the newest contributing measurement's UTC timestamp and decimal-string value:

```json
{
  "last": {
    "ts": "2026-10-07T10:50:00Z",
    "value": "22"
  }
}
```

Order by measurement timestamp, not insertion or arrival time. Only points within both the requested range and the bucket contribute. An older point arriving later can change other aggregates but does not replace a newer last point. Point identity prevents multiple values at the same series timestamp. Empty buckets return `last: null`.

The PDF requires last but does not prescribe its shape. Returning timestamp and value makes the selected measurement explicit. SQL must select both fields from the same point.

## Numeric aggregate representation

- Return sum, min, max, and last.value as decimal strings, preserving their numeric values without application rounding or JavaScript Number conversion. No fixed two-decimal display rule is applied.
- Return count as a JSON integer while it is within Number.MAX_SAFE_INTEGER, otherwise as a decimal string to preserve exactness.
- Calculate `AVG(value)` in PostgreSQL and return its NUMERIC result as a decimal string, without additional rounding in NestJS or a fixed response scale.
- Include exact sum and count alongside avg. They retain the information needed to express the mathematical average as sum divided by count.
- For an empty bucket, avg and other aggregate values are null as specified above.

### Average precision assumption

Finite decimal sums and extrema are exact within PostgreSQL's supported numeric bounds. Division can produce a repeating decimal, such as 1/3, which PostgreSQL AVG represents with finite precision. A string prevents further JavaScript precision loss but does not make that finite average mathematically exact.

Returning PostgreSQL's NUMERIC average without extra application rounding is the agreed practical interpretation. Document this limitation explicitly in the final README; the PDF does not prescribe average precision or rounding. If the evaluator requires literal mathematical exactness for repeating averages, the contract needs an exact-ratio representation or clarification. Do not claim that this decision fully resolves that ambiguity.

## Latest-point endpoint

`GET /v1/series/:id/latest` returns the point with the greatest measurement timestamp, not the point most recently inserted.

| Situation                            | HTTP response                      |
| ------------------------------------ | ---------------------------------- |
| Existing series with measurements    | 200 with `{ seriesId, ts, value }` |
| Existing series with no measurements | 200 with JSON null                 |
| Unknown series                       | 404 Not Found                      |

Return seriesId as a decimal string, ts in UTC preserving microseconds, and value as a decimal string without extra rounding.

For example, if points at 10:00 and 10:30 already exist, inserting a late point at 10:15 does not change latest: the 10:30 point remains newest.

The PDF requires the most recent point and p95 latency at most 50 ms during ingestion. Its missing-measurement rule supports null for an empty series; it does not prescribe these status codes or response shape. Distinguishing an empty known series from an unknown ID makes the contract explicit.

Query PostgreSQL directly, ordered by timestamp descending with a limit of one. The composite primary-key index on `(series_id, ts)` is the initial candidate for this query; verify its plan and latency under load rather than adding another index by assumption. Determine series existence and latest consistently, preferably in one statement to avoid unnecessary round trips.

## Remaining verification

- Query inputs use the same microsecond timestamp grammar as ingestion. Native numeric/timestamp result overflow returns 422, and statement timeout returns retryable 429.
- Capture full-dataset SQL plans, indexing comparisons, and query latency before claiming performance targets.

# Stats endpoint contract

The PDF requires `GET /v1/stats` to return row counts and per-series coverage. It does not prescribe a response shape or define coverage. The following is the implemented interpretation.

## Response content

- Total series count.
- Total measurement count.
- For each series: series ID, name, point count, earliest measurement timestamp, and latest measurement timestamp.
- Include empty series with point count zero and null earliest/latest timestamps.
- Return series IDs as decimal strings and timestamps in UTC while preserving microseconds.

Coverage means the interval bounded by the earliest and latest stored measurement timestamps. It does not mean the interval is continuously populated; gaps may exist.

## Accuracy and implementation

PostgreSQL calculates exact counts and timestamp bounds, not estimates from database statistics or application aggregation over raw measurements. One SQL statement returns totals and per-series statistics from a consistent snapshot. The response is `{ totalSeries, totalMeasurements, series: [{ seriesId, name, count, from, to }] }`. Counts are JSON integers while safe, otherwise decimal strings.

No additional stats index or cached counter table is agreed. Measure the query first and justify any optimization without compromising late-arrival, replay, or restart correctness.

import { utcSql } from '../validation/timestamp';

/** Original query retained only for reproducible before/after measurement. */
export const baselineBucketSql = `
  WITH aggregates AS (
    SELECT date_trunc($4::text, ts, 'UTC') AS bucket,
      count(*) AS count, sum(value) AS sum, min(value) AS min, max(value) AS max, avg(value) AS avg
    FROM measurements
    WHERE series_id = $1::bigint AND ts >= $2::timestamptz AND ts < $3::timestamptz
    GROUP BY 1
  ), bounds AS (
    SELECT date_trunc($4::text, $2::timestamptz, 'UTC') AS first_bucket,
      date_trunc($4::text, $3::timestamptz - interval '1 microsecond', 'UTC') AS final_bucket
  ), buckets AS (
    SELECT first_bucket + step * $5::interval AS bucket
    FROM bounds CROSS JOIN LATERAL generate_series(0::bigint,
      (extract(epoch FROM final_bucket - first_bucket) / extract(epoch FROM $5::interval))::bigint) AS steps(step)
  )
  SELECT ${utcSql('b.bucket')} AS "bucketStart", coalesce(a.count, 0)::text AS count,
    a.sum::text AS sum, a.min::text AS min, a.max::text AS max, a.avg::text AS avg,
    ${utcSql('last_point.ts')} AS "lastTs", last_point.value::text AS "lastValue"
  FROM buckets b LEFT JOIN aggregates a ON a.bucket = b.bucket
  LEFT JOIN LATERAL (
    SELECT ts, value FROM measurements
    WHERE a.count > 0 AND series_id = $1::bigint
      AND ts >= greatest(b.bucket, $2::timestamptz)
      AND ts < CASE WHEN b.bucket = date_trunc($4::text, $3::timestamptz - interval '1 microsecond', 'UTC')
        THEN $3::timestamptz ELSE b.bucket + $5::interval END
    ORDER BY ts DESC LIMIT 1
  ) last_point ON true
  ORDER BY b.bucket`;

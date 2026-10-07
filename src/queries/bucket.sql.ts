import { utcSql } from '../validation/timestamp';

/** Index-range aggregates avoid date_trunc/hash grouping for every measurement. */
export const bucketSql = `
  WITH bounds AS (
    SELECT date_trunc($4::text, $2::timestamptz, 'UTC') AS first_bucket,
      date_trunc($4::text, $3::timestamptz - interval '1 microsecond', 'UTC') AS final_bucket
  ), buckets AS (
    SELECT first_bucket + step * $5::interval AS bucket, final_bucket
    FROM bounds CROSS JOIN LATERAL generate_series(0::bigint,
      (extract(epoch FROM final_bucket - first_bucket) / extract(epoch FROM $5::interval))::bigint) AS steps(step)
  )
  SELECT ${utcSql('b.bucket')} AS "bucketStart", a.count::text AS count,
    a.sum::text AS sum, a.min::text AS min, a.max::text AS max, a.avg::text AS avg,
    ${utcSql('a.last_ts')} AS "lastTs", last_point.value::text AS "lastValue"
  FROM buckets b CROSS JOIN LATERAL (
    SELECT count(*) AS count, sum(value) AS sum, min(value) AS min,
      max(value) AS max, avg(value) AS avg, max(ts) AS last_ts
    FROM measurements
    WHERE series_id = $1::bigint
      AND ts >= greatest(b.bucket, $2::timestamptz)
      AND ts < CASE WHEN b.bucket = b.final_bucket
        THEN $3::timestamptz ELSE b.bucket + $5::interval END
  ) a
  LEFT JOIN measurements last_point
    ON last_point.series_id = $1::bigint AND last_point.ts = a.last_ts
  ORDER BY b.bucket`;

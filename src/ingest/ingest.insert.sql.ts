/** Returns one insertion summary, emitting identities only for mixed batches. */
export const insertSummarySql = `
  WITH inserted AS (
    INSERT INTO measurements (series_id, ts, value)
    SELECT series_id, ts, value
    FROM unnest($1::bigint[], $2::timestamptz[], $3::numeric[])
      AS input(series_id, ts, value)
    ORDER BY series_id, ts
    ON CONFLICT (series_id, ts) DO NOTHING
    RETURNING series_id, ts
  ), summary AS (
    SELECT count(*)::integer AS count FROM inserted
  )
  SELECT count AS "insertedCount",
    CASE WHEN count < cardinality($1::bigint[])
      THEN ARRAY(SELECT series_id::text || ':' || ts::text FROM inserted)
      ELSE ARRAY[]::text[]
    END AS identities
  FROM summary`;

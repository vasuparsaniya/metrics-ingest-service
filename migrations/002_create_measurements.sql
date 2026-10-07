CREATE TABLE measurements (
  series_id BIGINT NOT NULL REFERENCES series(id),
  ts TIMESTAMPTZ NOT NULL CHECK (isfinite(ts)),
  value NUMERIC NOT NULL CHECK (value NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)),
  PRIMARY KEY (series_id, ts)
);

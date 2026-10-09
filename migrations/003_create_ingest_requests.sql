CREATE TABLE ingest_requests (
  idempotency_key VARCHAR(128) PRIMARY KEY CHECK (idempotency_key ~ '^[!-~]{1,128}$'),
  payload_hash BYTEA NOT NULL CHECK (octet_length(payload_hash) = 32),
  response_body JSONB CHECK (response_body IS NULL OR jsonb_typeof(response_body) = 'object')
);

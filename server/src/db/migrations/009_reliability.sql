CREATE TABLE outbox (
  id            BIGSERIAL PRIMARY KEY,
  kind          TEXT        NOT NULL CHECK (kind IN ('email')),
  payload       JSONB       NOT NULL,
  attempts      INT         NOT NULL DEFAULT 0,
  available_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at       TIMESTAMPTZ,
  last_error    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX outbox_pending_idx ON outbox (available_at) WHERE sent_at IS NULL;

CREATE TABLE idempotency_keys (
  user_id       BIGINT      NOT NULL REFERENCES users ON DELETE CASCADE,
  key           TEXT        NOT NULL,
  request_path  TEXT        NOT NULL,
  status        INT,
  response      JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
CREATE INDEX idempotency_keys_created_idx ON idempotency_keys (created_at);

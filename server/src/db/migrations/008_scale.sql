CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX invoices_subscription_idx ON invoices (subscription_id, period_start DESC);
CREATE INDEX invoices_issue_date_idx ON invoices (issue_date);
CREATE INDEX subscriptions_plan_idx ON subscriptions (plan_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);
DROP INDEX payments_paid_on_idx;
CREATE INDEX payments_paid_on_idx ON payments (paid_on, id);

CREATE INDEX users_name_trgm ON users USING gin (name gin_trgm_ops);
CREATE INDEX users_email_trgm ON users USING gin ((email::text) gin_trgm_ops);
CREATE INDEX subscriptions_number_trgm ON subscriptions USING gin (number gin_trgm_ops);
CREATE INDEX invoices_number_trgm ON invoices USING gin (number gin_trgm_ops);

CREATE UNLOGGED TABLE rate_limits (
  key           TEXT        NOT NULL,
  window_start  TIMESTAMPTZ NOT NULL,
  hits          INT         NOT NULL DEFAULT 1,
  PRIMARY KEY (key, window_start)
);

CREATE TABLE mrr_snapshots (
  snapshot_date  DATE          NOT NULL,
  customer_id    BIGINT        NOT NULL REFERENCES users ON DELETE CASCADE,
  mrr            NUMERIC(14,4) NOT NULL,
  PRIMARY KEY (snapshot_date, customer_id)
);

CREATE TABLE mrr_snapshot_runs (
  snapshot_date  DATE        PRIMARY KEY,
  computed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

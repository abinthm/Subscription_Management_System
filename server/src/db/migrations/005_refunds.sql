CREATE TABLE refunds (
  id           BIGSERIAL PRIMARY KEY,
  payment_id   BIGINT        NOT NULL UNIQUE REFERENCES payments,
  amount       NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  reason       TEXT          NOT NULL,
  refunded_on  DATE          NOT NULL DEFAULT CURRENT_DATE,
  refunded_by  BIGINT        REFERENCES users ON DELETE SET NULL,
  gateway_ref  TEXT          UNIQUE,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX refunds_refunded_on_idx ON refunds (refunded_on);

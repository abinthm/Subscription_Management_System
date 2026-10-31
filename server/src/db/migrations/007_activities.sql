CREATE TABLE activities (
  id               BIGSERIAL PRIMARY KEY,
  subscription_id  BIGINT      REFERENCES subscriptions ON DELETE CASCADE,
  invoice_id       BIGINT      REFERENCES invoices ON DELETE CASCADE,
  actor_id         BIGINT      REFERENCES users ON DELETE SET NULL,
  action           TEXT        NOT NULL,
  message          TEXT        NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (subscription_id IS NOT NULL OR invoice_id IS NOT NULL)
);
CREATE INDEX activities_subscription_idx ON activities (subscription_id, created_at) WHERE subscription_id IS NOT NULL;
CREATE INDEX activities_invoice_idx ON activities (invoice_id, created_at) WHERE invoice_id IS NOT NULL;

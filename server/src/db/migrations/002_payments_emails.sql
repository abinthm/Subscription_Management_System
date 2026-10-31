ALTER TABLE payments ADD COLUMN gateway_ref TEXT UNIQUE;

CREATE TABLE email_log (
  kind        TEXT        NOT NULL,
  invoice_id  BIGINT      NOT NULL REFERENCES invoices ON DELETE CASCADE,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, invoice_id)
);

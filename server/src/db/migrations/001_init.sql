CREATE EXTENSION IF NOT EXISTS citext;

CREATE TYPE user_role       AS ENUM ('admin', 'staff', 'customer');
CREATE TYPE product_type    AS ENUM ('service', 'goods');
CREATE TYPE billing_period  AS ENUM ('daily', 'weekly', 'monthly', 'yearly');
CREATE TYPE sub_status      AS ENUM ('draft', 'quotation', 'confirmed', 'active', 'paused', 'closed');
CREATE TYPE invoice_status  AS ENUM ('draft', 'confirmed', 'paid', 'cancelled');
CREATE TYPE discount_type   AS ENUM ('fixed', 'percentage');
CREATE TYPE discount_scope  AS ENUM ('subscription', 'product');
CREATE TYPE payment_method  AS ENUM ('cash', 'bank_transfer', 'card', 'upi', 'cheque');

CREATE TABLE users (
  id            BIGSERIAL PRIMARY KEY,
  email         CITEXT       NOT NULL UNIQUE,
  name          TEXT         NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  password_hash TEXT         NOT NULL,
  role          user_role    NOT NULL DEFAULT 'customer',
  phone         TEXT,
  address       TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX users_role_idx ON users (role);

CREATE TABLE sessions (
  token_hash  TEXT        PRIMARY KEY,
  user_id     BIGINT      NOT NULL REFERENCES users ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE password_resets (
  token_hash  TEXT        PRIMARY KEY,
  user_id     BIGINT      NOT NULL REFERENCES users ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ
);

CREATE TABLE taxes (
  id      BIGSERIAL PRIMARY KEY,
  name    TEXT          NOT NULL UNIQUE,
  rate    NUMERIC(5,2)  NOT NULL CHECK (rate >= 0 AND rate <= 100),
  active  BOOLEAN       NOT NULL DEFAULT true
);

CREATE TABLE products (
  id           BIGSERIAL PRIMARY KEY,
  name         TEXT           NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  type         product_type   NOT NULL DEFAULT 'service',
  sales_price  NUMERIC(12,2)  NOT NULL CHECK (sales_price >= 0),
  cost_price   NUMERIC(12,2)  NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
  tax_id       BIGINT         REFERENCES taxes ON DELETE SET NULL,
  notes        TEXT,
  active       BOOLEAN        NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE TABLE product_variants (
  id           BIGSERIAL PRIMARY KEY,
  product_id   BIGINT         NOT NULL REFERENCES products ON DELETE CASCADE,
  attribute    TEXT           NOT NULL,
  value        TEXT           NOT NULL,
  extra_price  NUMERIC(12,2)  NOT NULL DEFAULT 0 CHECK (extra_price >= 0),
  UNIQUE (product_id, attribute, value)
);

CREATE TABLE plans (
  id              BIGSERIAL PRIMARY KEY,
  name            TEXT           NOT NULL UNIQUE,
  price           NUMERIC(12,2)  NOT NULL CHECK (price >= 0),
  billing_period  billing_period NOT NULL,
  min_quantity    INT            NOT NULL DEFAULT 1 CHECK (min_quantity >= 1),
  start_date      DATE           NOT NULL DEFAULT CURRENT_DATE,
  end_date        DATE,
  auto_close      BOOLEAN        NOT NULL DEFAULT false,
  closable        BOOLEAN        NOT NULL DEFAULT true,
  pausable        BOOLEAN        NOT NULL DEFAULT true,
  renewable       BOOLEAN        NOT NULL DEFAULT true,
  active          BOOLEAN        NOT NULL DEFAULT true,
  CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE TABLE discounts (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT           NOT NULL UNIQUE,
  type          discount_type  NOT NULL,
  value         NUMERIC(12,2)  NOT NULL CHECK (value > 0),
  scope         discount_scope NOT NULL DEFAULT 'subscription',
  min_amount    NUMERIC(12,2)  NOT NULL DEFAULT 0 CHECK (min_amount >= 0),
  min_quantity  INT            NOT NULL DEFAULT 0 CHECK (min_quantity >= 0),
  start_date    DATE           NOT NULL DEFAULT CURRENT_DATE,
  end_date      DATE,
  usage_limit   INT            CHECK (usage_limit IS NULL OR usage_limit > 0),
  used_count    INT            NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  active        BOOLEAN        NOT NULL DEFAULT true,
  CHECK (type <> 'percentage' OR value <= 100),
  CHECK (end_date IS NULL OR end_date >= start_date),
  CHECK (usage_limit IS NULL OR used_count <= usage_limit)
);

CREATE TABLE discount_products (
  discount_id  BIGINT NOT NULL REFERENCES discounts ON DELETE CASCADE,
  product_id   BIGINT NOT NULL REFERENCES products  ON DELETE CASCADE,
  PRIMARY KEY (discount_id, product_id)
);

CREATE TABLE quotation_templates (
  id             BIGSERIAL PRIMARY KEY,
  name           TEXT   NOT NULL UNIQUE,
  plan_id        BIGINT NOT NULL REFERENCES plans,
  validity_days  INT    NOT NULL DEFAULT 30 CHECK (validity_days BETWEEN 1 AND 365),
  notes          TEXT
);

CREATE TABLE quotation_template_lines (
  id           BIGSERIAL PRIMARY KEY,
  template_id  BIGINT NOT NULL REFERENCES quotation_templates ON DELETE CASCADE,
  product_id   BIGINT NOT NULL REFERENCES products,
  variant_id   BIGINT REFERENCES product_variants,
  quantity     INT    NOT NULL CHECK (quantity >= 1)
);

CREATE SEQUENCE subscription_number_seq;
CREATE SEQUENCE invoice_number_seq;

CREATE TABLE subscriptions (
  id                 BIGSERIAL PRIMARY KEY,
  number             TEXT        NOT NULL UNIQUE
                       DEFAULT 'SUB-' || lpad(nextval('subscription_number_seq')::text, 6, '0'),
  customer_id        BIGINT      NOT NULL REFERENCES users,
  plan_id            BIGINT      NOT NULL REFERENCES plans,
  discount_id        BIGINT      REFERENCES discounts ON DELETE SET NULL,
  status             sub_status  NOT NULL DEFAULT 'draft',
  start_date         DATE        NOT NULL DEFAULT CURRENT_DATE,
  expiry_date        DATE,
  payment_terms_days INT         NOT NULL DEFAULT 15 CHECK (payment_terms_days BETWEEN 0 AND 180),
  next_invoice_date  DATE,
  billed_periods     INT         NOT NULL DEFAULT 0 CHECK (billed_periods >= 0),
  valid_until        DATE,
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (expiry_date IS NULL OR expiry_date >= start_date)
);
CREATE INDEX subscriptions_customer_idx ON subscriptions (customer_id);
CREATE INDEX subscriptions_status_idx   ON subscriptions (status);
CREATE INDEX subscriptions_due_idx      ON subscriptions (next_invoice_date) WHERE status = 'active';

CREATE TABLE subscription_lines (
  id               BIGSERIAL PRIMARY KEY,
  subscription_id  BIGINT         NOT NULL REFERENCES subscriptions ON DELETE CASCADE,
  product_id       BIGINT         NOT NULL REFERENCES products,
  variant_id       BIGINT         REFERENCES product_variants,
  quantity         INT            NOT NULL CHECK (quantity >= 1),
  unit_price       NUMERIC(12,2)  NOT NULL CHECK (unit_price >= 0),
  tax_id           BIGINT         REFERENCES taxes
);
CREATE INDEX subscription_lines_sub_idx ON subscription_lines (subscription_id);

CREATE TABLE invoices (
  id               BIGSERIAL PRIMARY KEY,
  number           TEXT           NOT NULL UNIQUE
                     DEFAULT 'INV-' || lpad(nextval('invoice_number_seq')::text, 6, '0'),
  subscription_id  BIGINT         NOT NULL REFERENCES subscriptions,
  customer_id      BIGINT         NOT NULL REFERENCES users,
  status           invoice_status NOT NULL DEFAULT 'draft',
  period_start     DATE           NOT NULL,
  period_end       DATE           NOT NULL,
  issue_date       DATE           NOT NULL DEFAULT CURRENT_DATE,
  due_date         DATE           NOT NULL,
  subtotal         NUMERIC(12,2)  NOT NULL CHECK (subtotal >= 0),
  discount_total   NUMERIC(12,2)  NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
  tax_total        NUMERIC(12,2)  NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  total            NUMERIC(12,2)  NOT NULL CHECK (total >= 0),
  amount_paid      NUMERIC(12,2)  NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  discount_id      BIGINT         REFERENCES discounts ON DELETE SET NULL,
  sent_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ    NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start),
  CHECK (amount_paid <= total)
);
CREATE UNIQUE INDEX invoices_one_per_period
  ON invoices (subscription_id, period_start) WHERE status <> 'cancelled';
CREATE INDEX invoices_customer_idx ON invoices (customer_id);
CREATE INDEX invoices_status_due_idx ON invoices (status, due_date);

CREATE TABLE invoice_lines (
  id               BIGSERIAL PRIMARY KEY,
  invoice_id       BIGINT         NOT NULL REFERENCES invoices ON DELETE CASCADE,
  product_id       BIGINT         REFERENCES products ON DELETE SET NULL,
  description      TEXT           NOT NULL,
  quantity         INT            NOT NULL CHECK (quantity >= 1),
  unit_price       NUMERIC(12,2)  NOT NULL,
  discount_amount  NUMERIC(12,2)  NOT NULL DEFAULT 0,
  tax_rate         NUMERIC(5,2)   NOT NULL DEFAULT 0,
  tax_amount       NUMERIC(12,2)  NOT NULL DEFAULT 0,
  amount           NUMERIC(12,2)  NOT NULL
);
CREATE INDEX invoice_lines_invoice_idx ON invoice_lines (invoice_id);

CREATE TABLE payments (
  id           BIGSERIAL PRIMARY KEY,
  invoice_id   BIGINT         NOT NULL REFERENCES invoices,
  method       payment_method NOT NULL,
  amount       NUMERIC(12,2)  NOT NULL CHECK (amount > 0),
  paid_on      DATE           NOT NULL DEFAULT CURRENT_DATE,
  note         TEXT,
  recorded_by  BIGINT         REFERENCES users ON DELETE SET NULL,
  created_at   TIMESTAMPTZ    NOT NULL DEFAULT now()
);
CREATE INDEX payments_invoice_idx ON payments (invoice_id);
CREATE INDEX payments_paid_on_idx ON payments (paid_on);

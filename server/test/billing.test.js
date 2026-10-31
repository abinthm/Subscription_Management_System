import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ??= 'postgres://localhost:5432/subscriptions_test';
const { pool, query } = await import('../src/db/pool.js');
const { migrate } = await import('../src/db/migrate.js');
const { runBilling } = await import('../src/modules/invoices/service.js');
const { addDays, today } = await import('../src/lib/dates.js');

let subId;

before(async () => {
  await query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate();
  const one = async (sql, params) => (await query(sql, params)).rows[0].id;
  const customer = await one("INSERT INTO users (name, email, password_hash) VALUES ('T', 't@x.io', 'x') RETURNING id");
  const tax = await one("INSERT INTO taxes (name, rate) VALUES ('GST', 18) RETURNING id");
  const product = await one('INSERT INTO products (name, sales_price, tax_id) VALUES ($1, 100, $2) RETURNING id', ['P', tax]);
  const plan = await one("INSERT INTO plans (name, price, billing_period, start_date) VALUES ('Weekly', 100, 'weekly', '2020-01-01') RETURNING id");
  const discount = await one("INSERT INTO discounts (name, type, value, usage_limit, start_date) VALUES ('Once', 'percentage', 50, 1, '2020-01-01') RETURNING id");
  const start = addDays(today(), -20);
  subId = await one(
    `INSERT INTO subscriptions (customer_id, plan_id, discount_id, status, start_date, next_invoice_date)
     VALUES ($1, $2, $3, 'active', $4, $4) RETURNING id`,
    [customer, plan, discount, start],
  );
  await query('INSERT INTO subscription_lines (subscription_id, product_id, quantity, unit_price, tax_id) VALUES ($1, $2, 2, 100, $3)', [subId, product, tax]);
});

after(() => pool.end());

test('billing catches up every elapsed period exactly once', async () => {
  const first = await runBilling();
  assert.equal(first.created, 3);
  assert.deepEqual(first.failed, []);

  const again = await runBilling();
  assert.equal(again.created, 0);

  const { rows } = await query('SELECT period_start, total, discount_total FROM invoices WHERE subscription_id = $1 ORDER BY period_start', [subId]);
  assert.equal(rows.length, 3);
  assert.equal(new Set(rows.map((r) => r.period_start)).size, 3);
  assert.equal(rows[0].discount_total, 100);
  assert.equal(rows[0].total, 118);
  assert.equal(rows[1].discount_total, 0);
  assert.equal(rows[1].total, 236);
});

test('the database refuses a second live invoice for the same period', async () => {
  const { rows } = await query('SELECT * FROM invoices WHERE subscription_id = $1 LIMIT 1', [subId]);
  const i = rows[0];
  await assert.rejects(
    query(
      `INSERT INTO invoices (subscription_id, customer_id, period_start, period_end, due_date, subtotal, total)
       VALUES ($1, $2, $3, $4, $5, 0, 0)`,
      [i.subscription_id, i.customer_id, i.period_start, i.period_end, i.due_date],
    ),
    { code: '23505' },
  );
});

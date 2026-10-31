import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ??= 'postgres://localhost:5432/subscriptions_test';
const { pool, query } = await import('../src/db/pool.js');
const { migrate } = await import('../src/db/migrate.js');
const { runBilling, invoiceNow } = await import('../src/modules/invoices/service.js');
const { changeLines, setDiscount } = await import('../src/modules/subscriptions/service.js');
const { today } = await import('../src/lib/dates.js');

const admin = { id: null, role: 'admin' };
let subId;
let productId;
let customerId;

before(async () => {
  await query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate();
  const one = async (sql, params) => (await query(sql, params)).rows[0].id;
  customerId = await one("INSERT INTO users (name, email, password_hash) VALUES ('T', 't@x.io', 'x') RETURNING id");
  productId = await one("INSERT INTO products (name, sales_price) VALUES ('Seat', 100) RETURNING id");
  const plan = await one("INSERT INTO plans (name, price, billing_period, start_date) VALUES ('Monthly', 0, 'monthly', '2020-01-01') RETURNING id");
  subId = await one(
    "INSERT INTO subscriptions (customer_id, plan_id, status, start_date, next_invoice_date) VALUES ($1, $2, 'active', $3, $3) RETURNING id",
    [customerId, plan, today()],
  );
  await query('INSERT INTO subscription_lines (subscription_id, product_id, quantity, unit_price) VALUES ($1, $2, 2, 100)', [subId, productId]);
});

after(() => pool.end());

test('seat and discount changes apply from the next invoice only', async () => {
  assert.equal((await runBilling()).created, 1);
  const discount = (await query(
    "INSERT INTO discounts (name, type, value, usage_limit, start_date) VALUES ('Loyal', 'percentage', 10, 5, '2020-01-01') RETURNING id",
  )).rows[0].id;

  await changeLines(subId, [{ product_id: productId, variant_id: null, quantity: 5 }], admin);
  await setDiscount(subId, discount, admin);
  const next = await invoiceNow(subId, admin);

  assert.equal(next.lines[0].quantity, 5);
  assert.equal(next.subtotal, 500);
  assert.equal(next.discount_total, 50);
  assert.equal(next.total, 450);

  const { rows } = await query(
    `SELECT i.total, l.quantity FROM invoices i JOIN invoice_lines l ON l.invoice_id = i.id
      WHERE i.subscription_id = $1 ORDER BY i.period_start LIMIT 1`,
    [subId],
  );
  assert.deepEqual(rows[0], { total: 200, quantity: 2 });
  assert.equal((await query('SELECT used_count FROM discounts WHERE id = $1', [discount])).rows[0].used_count, 1);
});

test('customers cannot change someone else\'s subscription and spent discounts are refused', async () => {
  await assert.rejects(
    changeLines(subId, [{ product_id: productId, variant_id: null, quantity: 1 }], { id: customerId + 1, role: 'customer' }),
    { status: 404 },
  );
  const spent = (await query(
    "INSERT INTO discounts (name, type, value, usage_limit, used_count, start_date) VALUES ('Gone', 'fixed', 5, 1, 1, '2020-01-01') RETURNING id",
  )).rows[0].id;
  await assert.rejects(setDiscount(subId, spent, admin), { status: 400 });
});

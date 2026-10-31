import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ??= 'postgres://localhost:5432/subscriptions_test';
const { pool, query } = await import('../src/db/pool.js');
const { migrate } = await import('../src/db/migrate.js');
const { listPayments } = await import('../src/modules/payments/service.js');
const { runBilling } = await import('../src/modules/invoices/service.js');
const { runDailyJobs } = await import('../src/jobs.js');
const { addDays, today } = await import('../src/lib/dates.js');

before(async () => {
  await query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate();
  const one = async (sql, params) => (await query(sql, params)).rows[0].id;
  const customer = await one("INSERT INTO users (name, email, password_hash) VALUES ('T', 't@x.io', 'x') RETURNING id");
  const plan = await one("INSERT INTO plans (name, price, billing_period, start_date) VALUES ('W', 10, 'weekly', '2020-01-01') RETURNING id");
  const product = await one("INSERT INTO products (name, sales_price) VALUES ('P', 5) RETURNING id");
  for (let i = 0; i < 30; i += 1) {
    const sub = await one(
      "INSERT INTO subscriptions (customer_id, plan_id, status, start_date, next_invoice_date) VALUES ($1, $2, 'active', $3, $3) RETURNING id",
      [customer, plan, addDays(today(), -20)],
    );
    await query('INSERT INTO subscription_lines (subscription_id, product_id, quantity, unit_price) VALUES ($1, $2, 1, 5)', [sub, product]);
  }
});

after(() => pool.end());

test('parallel billing runs never double-bill', async () => {
  const [a, b] = await Promise.all([runBilling(), runBilling()]);
  assert.equal(a.created + b.created, 90);
  const { rows } = await query('SELECT count(*)::int AS n, count(DISTINCT (subscription_id, period_start))::int AS d FROM invoices');
  assert.deepEqual(rows[0], { n: 90, d: 90 });
});

test('keyset pages walk every payment once, even with tied dates', async () => {
  await query(
    `INSERT INTO payments (invoice_id, method, amount, paid_on)
     SELECT id, 'cash', 1, CURRENT_DATE - (id % 3)::int FROM invoices`,
  );
  const seen = [];
  let cursor = null;
  let first = null;
  do {
    const page = await listPayments({ limit: 7, cursor, count: true });
    first ??= page;
    seen.push(...page.data.map((p) => p.id));
    cursor = page.next_cursor;
  } while (cursor);
  assert.equal(first.total, 90);
  assert.equal(seen.length, 90);
  assert.equal(new Set(seen).size, 90);
  await assert.rejects(listPayments({ limit: 7, cursor: "2026-01-01~1;DROP", count: true }), { status: 400 });
});

test('only one instance runs the hourly jobs at a time', async () => {
  const results = await Promise.all([runDailyJobs(), runDailyJobs()]);
  assert.equal(results.filter((r) => r === null).length, 1);
});

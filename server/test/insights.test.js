import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ??= 'postgres://localhost:5432/subscriptions_test';
const { pool, query } = await import('../src/db/pool.js');
const { migrate } = await import('../src/db/migrate.js');
const { growthInsights } = await import('../src/modules/insights/service.js');
const { addDays, today } = await import('../src/lib/dates.js');

before(async () => {
  await query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate();
  const one = async (sql, params) => (await query(sql, params)).rows[0].id;
  const plan = await one("INSERT INTO plans (name, price, billing_period, start_date) VALUES ('M', 0, 'monthly', '2020-01-01') RETURNING id");
  const customer = (name) => one("INSERT INTO users (name, email, password_hash) VALUES ($1, $2, 'x') RETURNING id", [name, `${name}@x.io`]);
  const [a, b, c] = [await customer('a'), await customer('b'), await customer('c')];

  const lastMonthEnd = addDays(`${today().slice(0, 8)}01`, -1);
  const bill = async (customerId, start, end, net) => {
    const sub = await one("INSERT INTO subscriptions (customer_id, plan_id, status) VALUES ($1, $2, 'active') RETURNING id", [customerId, plan]);
    await query(
      `INSERT INTO invoices (subscription_id, customer_id, period_start, period_end, due_date, subtotal, total)
       VALUES ($1, $2, $3, $4, $4, $5, $5)`,
      [sub, customerId, start, end, net],
    );
  };
  await bill(a, addDays(lastMonthEnd, -10), addDays(today(), 10), 100);
  await bill(a, today(), addDays(today(), 20), 50);
  await bill(b, addDays(lastMonthEnd, -10), lastMonthEnd, 100);
  await bill(c, today(), addDays(today(), 20), 70);
});

after(() => pool.end());

test('MRR movements classify new, expansion and churn per customer', async () => {
  const g = await growthInsights();
  const current = g.months.at(-1);
  assert.equal(current.mrr, 220);
  assert.equal(current.new, 70);
  assert.equal(current.expansion, 50);
  assert.equal(current.churned, 100);
  assert.equal(current.contraction, 0);
  assert.equal(current.customers, 2);
  assert.equal(g.months.at(-2).mrr, 200);
  assert.equal(g.kpis.mrr, 220);
});

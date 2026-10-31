import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

process.env.DATABASE_URL ??= 'postgres://localhost:5432/subscriptions_test';
process.env.RAZORPAY_KEY_ID = 'rzp_test_x';
process.env.RAZORPAY_KEY_SECRET = 'secret';
process.env.SMTP_HOST = '';
const { pool, query } = await import('../src/db/pool.js');
const { migrate } = await import('../src/db/migrate.js');
const { signatureValid } = await import('../src/lib/razorpay.js');
const { recordPayment } = await import('../src/modules/payments/service.js');
const { sendOverdueReminders } = await import('../src/modules/invoices/service.js');
const { addDays, today } = await import('../src/lib/dates.js');

let invoiceId;

before(async () => {
  await query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate();
  const one = async (sql, params) => (await query(sql, params)).rows[0].id;
  const customer = await one("INSERT INTO users (name, email, password_hash) VALUES ('T', 't@x.io', 'x') RETURNING id");
  const plan = await one("INSERT INTO plans (name, price, billing_period, start_date) VALUES ('M', 100, 'monthly', '2020-01-01') RETURNING id");
  const sub = await one(
    "INSERT INTO subscriptions (customer_id, plan_id, status, start_date) VALUES ($1, $2, 'active', '2020-01-01') RETURNING id",
    [customer, plan],
  );
  invoiceId = await one(
    `INSERT INTO invoices (subscription_id, customer_id, status, period_start, period_end, due_date, subtotal, total)
     VALUES ($1, $2, 'confirmed', '2020-01-01', '2020-01-31', $3, 100, 100) RETURNING id`,
    [sub, customer, addDays(today(), -3)],
  );
});

after(() => pool.end());

test('gateway signatures are checked against the secret', () => {
  const good = createHmac('sha256', 'secret').update('order_1|pay_1').digest('hex');
  assert.equal(signatureValid('order_1', 'pay_1', good), true);
  assert.equal(signatureValid('order_1', 'pay_2', good), false);
  assert.equal(signatureValid('order_1', 'pay_1', 'short'), false);
});

test('overdue reminders go out once per invoice', async () => {
  assert.equal(await sendOverdueReminders(), 1);
  assert.equal(await sendOverdueReminders(), 0);
});

test('a gateway payment is recorded once even when verified twice', async () => {
  const input = { invoice_id: invoiceId, method: 'upi', amount: 100, paid_on: today(), note: null, gateway_ref: 'pay_1' };
  const first = await recordPayment(input, null);
  const again = await recordPayment(input, null);
  assert.equal(again.id, first.id);
  assert.equal(again.duplicate, true);

  const { rows } = await query('SELECT status, amount_paid FROM invoices WHERE id = $1', [invoiceId]);
  assert.deepEqual(rows[0], { status: 'paid', amount_paid: 100 });
});

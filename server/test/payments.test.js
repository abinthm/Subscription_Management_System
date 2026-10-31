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
const { recordPayment, refundPayment } = await import('../src/modules/payments/service.js');
const { summary } = await import('../src/modules/reports/service.js');
const { sendOverdueReminders } = await import('../src/modules/invoices/service.js');
const { addDays, today } = await import('../src/lib/dates.js');

let invoiceId;
let planId;

before(async () => {
  await query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate();
  const one = async (sql, params) => (await query(sql, params)).rows[0].id;
  const customer = await one("INSERT INTO users (name, email, password_hash) VALUES ('T', 't@x.io', 'x') RETURNING id");
  planId = await one("INSERT INTO plans (name, price, billing_period, start_date) VALUES ('M', 100, 'monthly', '2020-01-01') RETURNING id");
  const sub = await one(
    "INSERT INTO subscriptions (customer_id, plan_id, status, start_date) VALUES ($1, $2, 'active', '2020-01-01') RETURNING id",
    [customer, planId],
  );
  invoiceId = await one(
    `INSERT INTO invoices (subscription_id, customer_id, status, period_start, period_end, due_date, subtotal, total)
     VALUES ($1, $2, 'confirmed', '2020-01-01', '2020-01-31', $3, 100, 100) RETURNING id`,
    [sub, customer, addDays(today(), -3)],
  );
  for (const [month, overdueDays] of [['02', 20], ['03', 60]]) {
    await query(
      `INSERT INTO invoices (subscription_id, customer_id, status, period_start, period_end, due_date, subtotal, total)
       VALUES ($1, $2, 'confirmed', $3, $3, $4, 50, 50)`,
      [sub, customer, `2020-${month}-01`, addDays(today(), -overdueDays)],
    );
  }
});

after(() => pool.end());

test('gateway signatures are checked against the secret', () => {
  const good = createHmac('sha256', 'secret').update('order_1|pay_1').digest('hex');
  assert.equal(signatureValid('order_1', 'pay_1', good), true);
  assert.equal(signatureValid('order_1', 'pay_2', good), false);
  assert.equal(signatureValid('order_1', 'pay_1', 'short'), false);
});

test('overdue reminders go out once per invoice and skip old debts', async () => {
  assert.equal(await sendOverdueReminders(), 2);
  assert.equal(await sendOverdueReminders(), 0);
  const { rows } = await query(
    'SELECT l.kind, CURRENT_DATE - i.due_date AS days FROM email_log l JOIN invoices i ON i.id = l.invoice_id ORDER BY days',
  );
  assert.deepEqual(rows, [{ kind: 'overdue', days: 3 }, { kind: 'final_notice', days: 20 }]);
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

test('a refund reopens the invoice once and nets out of revenue', async () => {
  const { rows } = await query("SELECT id FROM invoices WHERE period_start = '2020-02-01'");
  const payment = await recordPayment({ invoice_id: rows[0].id, method: 'cash', amount: 50, paid_on: today(), note: null }, null);
  await refundPayment(payment.id, 'Charged twice', null);
  await assert.rejects(refundPayment(payment.id, 'Again', null), { status: 409 });

  const { rows: after } = await query('SELECT status, amount_paid FROM invoices WHERE id = $1', [rows[0].id]);
  assert.deepEqual(after[0], { status: 'confirmed', amount_paid: 0 });

  const range = { from: '2000-01-01', to: today() };
  assert.equal((await summary({ ...range, planId })).revenue, 100);
  assert.equal((await summary({ ...range, planId: planId + 1 })).revenue, 0);
});

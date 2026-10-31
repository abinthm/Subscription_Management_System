import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ??= 'postgres://localhost:5432/subscriptions_test';
process.env.SMTP_HOST = '';
const { pool, query } = await import('../src/db/pool.js');
const { migrate } = await import('../src/db/migrate.js');
const subs = await import('../src/modules/subscriptions/service.js');
const { recordPayment } = await import('../src/modules/payments/service.js');
const { getInvoice } = await import('../src/modules/invoices/service.js');
const { today } = await import('../src/lib/dates.js');

let ids;

before(async () => {
  await query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate();
  const one = async (sql, params) => (await query(sql, params)).rows[0].id;
  ids = {
    staff: { id: await one("INSERT INTO users (name, email, password_hash, role) VALUES ('Sam', 's@x.io', 'x', 'staff') RETURNING id"), role: 'staff' },
    customer: { id: await one("INSERT INTO users (name, email, password_hash) VALUES ('Cara', 'c@x.io', 'x') RETURNING id"), role: 'customer' },
    plan: await one("INSERT INTO plans (name, price, billing_period, start_date) VALUES ('M', 100, 'monthly', '2020-01-01') RETURNING id"),
    product: await one("INSERT INTO products (name, sales_price) VALUES ('P', 50) RETURNING id"),
  };
});

after(() => pool.end());

test('the quote lifecycle leaves a readable trail, including the email', async () => {
  const sub = await subs.createSubscription({
    customer_id: ids.customer.id, plan_id: ids.plan, discount_id: null, start_date: today(), expiry_date: null,
    payment_terms_days: 15, valid_until: null, notes: null, lines: [{ product_id: ids.product, variant_id: null, quantity: 2 }],
  }, ids.staff);
  await subs.runAction(sub.id, 'send', ids.staff);
  const after = await subs.runAction(sub.id, 'confirm', ids.customer);

  assert.deepEqual(after.activity.map((a) => a.message).reverse(), [
    'Created as a draft',
    'Quotation sent to the customer',
    'Quotation emailed to c@x.io',
    'Quotation accepted by the customer',
  ]);
  assert.equal(after.activity[0].actor, 'Cara');
});

test('payments are logged on both the invoice and its subscription', async () => {
  const sub = await subs.subscribe({ plan_id: ids.plan, lines: [{ product_id: ids.product, variant_id: null, quantity: 1 }] }, ids.customer);
  await recordPayment({ invoice_id: sub.invoice_id, method: 'upi', amount: 60, paid_on: today(), note: null }, ids.staff.id);
  const invoice = await getInvoice(sub.invoice_id, ids.staff);
  assert.match(invoice.activity[0].message, /^Payment of ₹60\.00 received by upi .*₹90\.00 still due$/);
  const full = await subs.getSubscription(sub.id, ids.staff);
  assert.deepEqual(full.activity.map((a) => a.action), ['payment', 'invoiced', 'created']);
});

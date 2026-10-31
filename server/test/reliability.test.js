import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

process.env.DATABASE_URL ??= 'postgres://localhost:5432/subscriptions_test';
process.env.SMTP_HOST = '';
const { pool, query, transaction } = await import('../src/db/pool.js');
const { migrate } = await import('../src/db/migrate.js');
const { createApp } = await import('../src/app.js');
const { createUser } = await import('../src/modules/auth/service.js');
const { sendMail, drainOutbox } = await import('../src/lib/mailer.js');

let server;
let base;
let cookie;
let invoiceId;

async function post(path, body, key) {
  const res = await fetch(`${base}/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, ...(key && { 'Idempotency-Key': key }) },
    body: JSON.stringify(body),
  });
  return { status: res.status, replayed: res.headers.get('idempotent-replayed'), body: await res.json() };
}

before(async () => {
  await query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate();
  await createUser({ name: 'Sam', email: 'sam@x.io', password: 'Sturdy#pass1', role: 'staff' });
  const customer = (await createUser({ name: 'Cara', email: 'cara@x.io', password: 'Sturdy#pass1' })).id;
  const plan = (await query("INSERT INTO plans (name, price, billing_period, start_date) VALUES ('M', 10, 'monthly', '2020-01-01') RETURNING id")).rows[0].id;
  const sub = (await query("INSERT INTO subscriptions (customer_id, plan_id, status) VALUES ($1, $2, 'active') RETURNING id", [customer, plan])).rows[0].id;
  invoiceId = (await query(
    `INSERT INTO invoices (subscription_id, customer_id, status, period_start, period_end, due_date, subtotal, total)
     VALUES ($1, $2, 'confirmed', '2026-01-01', '2026-01-31', '2026-02-15', 100, 100) RETURNING id`,
    [sub, customer],
  )).rows[0].id;

  server = createApp().listen(0);
  await once(server, 'listening');
  base = `http://localhost:${server.address().port}`;
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'sam@x.io', password: 'Sturdy#pass1' }),
  });
  cookie = res.headers.getSetCookie()[0].split(';')[0];
});

after(async () => {
  server.close();
  await pool.end();
});

test('an email queued in a rolled-back transaction is never sent', async () => {
  await assert.rejects(transaction(async (db) => {
    await sendMail({ to: 'x@x.io', subject: 'nope', text: 'nope' }, db);
    throw new Error('boom');
  }));
  const { rows } = await query("SELECT count(*)::int AS n FROM outbox WHERE payload->>'subject' = 'nope'");
  assert.equal(rows[0].n, 0);
});

test('the outbox delivers committed emails and backs off failures', async () => {
  await sendMail({ to: 'ok@x.io', subject: 'hello', text: 'hi' });
  await sendMail({ subject: 'no recipient', text: 'hi' });
  await drainOutbox();
  const { rows } = await query("SELECT payload->>'subject' AS subject, sent_at IS NOT NULL AS sent, attempts, last_error IS NOT NULL AS failed, available_at > now() AS backing_off FROM outbox ORDER BY id");
  assert.deepEqual(rows.find((r) => r.subject === 'hello'), { subject: 'hello', sent: true, attempts: 1, failed: false, backing_off: true });
  assert.deepEqual(rows.find((r) => r.subject === 'no recipient'), { subject: 'no recipient', sent: false, attempts: 1, failed: true, backing_off: true });
  assert.equal(await drainOutbox(), 0);
});

test('retrying a payment with the same Idempotency-Key records it once', async () => {
  const body = { invoice_id: invoiceId, method: 'cash', amount: 40 };
  const first = await post('/payments', body, 'pay-key-0001');
  await new Promise((r) => setTimeout(r, 50));
  const again = await post('/payments', body, 'pay-key-0001');
  assert.equal(first.status, 201);
  assert.equal(again.status, 201);
  assert.equal(again.replayed, 'true');
  assert.equal(again.body.id, first.body.id);
  const { rows } = await query('SELECT count(*)::int AS n FROM payments');
  assert.equal(rows[0].n, 1);

  assert.equal((await post('/subscriptions/subscribe', {}, 'pay-key-0001')).status, 403);
  const overpay = await post('/payments', { ...body, amount: 1000 }, 'pay-key-0002');
  assert.equal(overpay.status, 400);
  const fixed = await post('/payments', body, 'pay-key-0002');
  assert.equal(fixed.status, 201);
});

test('readiness checks the database and every response carries a request id', async () => {
  const res = await fetch(`${base}/api/ready`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, database: 'up' });
  assert.match(res.headers.get('x-request-id'), /^[\w-]{8,64}$/);
  const traced = await fetch(`${base}/api/health`, { headers: { 'X-Request-Id': 'trace-abc-123' } });
  assert.equal(traced.headers.get('x-request-id'), 'trace-abc-123');
});

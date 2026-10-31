import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

process.env.DATABASE_URL ??= 'postgres://localhost:5432/subscriptions_test';
process.env.RAZORPAY_KEY_ID = '';
const { pool, query } = await import('../src/db/pool.js');
const { migrate } = await import('../src/db/migrate.js');
const { createApp } = await import('../src/app.js');
const { createUser } = await import('../src/modules/auth/service.js');

const PASSWORD = 'Sturdy#pass1';
const jar = {};
const ids = {};
let server;
let base;

async function call(who, method, path, body) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { ...(body && { 'Content-Type': 'application/json' }), ...(jar[who] && { Cookie: jar[who] }) },
    body: body && JSON.stringify(body),
  });
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith('sid='));
  if (who && cookie) jar[who] = cookie.split(';')[0];
  const text = await res.text();
  return { status: res.status, body: res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text };
}

const login = (who, email, password = PASSWORD) => call(who, 'POST', '/auth/login', { email, password });

before(async () => {
  await query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate();
  for (const [name, role] of [['admin', 'admin'], ['staff', 'staff'], ['alice', 'customer'], ['bob', 'customer']]) {
    ids[name] = (await createUser({ name, email: `${name}@x.io`, password: PASSWORD, role })).id;
  }
  const plan = (await query("INSERT INTO plans (name, price, billing_period, start_date) VALUES ('M', 10, 'monthly', '2020-01-01') RETURNING id")).rows[0].id;
  for (const name of ['alice', 'bob']) {
    const sub = (await query(
      "INSERT INTO subscriptions (customer_id, plan_id, status, start_date) VALUES ($1, $2, 'active', '2020-01-01') RETURNING id",
      [ids[name], plan],
    )).rows[0].id;
    const inv = (await query(
      `INSERT INTO invoices (subscription_id, customer_id, status, period_start, period_end, due_date, subtotal, total)
       VALUES ($1, $2, 'confirmed', '2020-01-01', '2020-01-31', '2020-02-15', 10, 10) RETURNING id, number`,
      [sub, ids[name]],
    )).rows[0];
    Object.assign(ids, { [`${name}Sub`]: sub, [`${name}Inv`]: inv.id, [`${name}InvNumber`]: inv.number });
  }

  server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
  for (const name of ['admin', 'staff', 'alice', 'bob']) assert.equal((await login(name, `${name}@x.io`)).status, 200);
});

after(async () => {
  server.close();
  await pool.end();
});

test('signup enforces password rules and unique emails', async () => {
  const weak = await call(null, 'POST', '/auth/signup', { name: 'Eve', email: 'eve@x.io', password: 'short' });
  assert.equal(weak.status, 400);
  assert.ok(weak.body.details.password);
  assert.equal((await call(null, 'POST', '/auth/signup', { name: 'Eve', email: 'eve@x.io', password: PASSWORD })).status, 201);
  assert.equal((await call(null, 'POST', '/auth/signup', { name: 'Eve', email: 'EVE@x.io', password: PASSWORD })).status, 409);
});

test('customers only reach their own records', async () => {
  assert.equal((await call('alice', 'GET', `/subscriptions/${ids.bobSub}`)).status, 404);
  assert.equal((await call('alice', 'GET', `/invoices/${ids.bobInv}`)).status, 404);
  assert.equal((await call('alice', 'GET', `/invoices/${ids.aliceInv}`)).status, 200);
  assert.equal((await call('alice', 'PUT', `/subscriptions/${ids.bobSub}/lines`, { lines: [{ product_id: 1, quantity: 1 }] })).status, 404);
  assert.equal((await call('alice', 'GET', '/users')).status, 403);
  assert.equal((await call('alice', 'PUT', `/users/${ids.bob}/active`, { active: false })).status, 403);
});

test('CSV export only contains the customer\'s own rows', async () => {
  const csv = await call('alice', 'GET', '/invoices?format=csv');
  assert.equal(csv.status, 200);
  assert.ok(csv.body.includes(ids.aliceInvNumber));
  assert.ok(!csv.body.includes(ids.bobInvNumber));
});

test('role guards on staff accounts and self-service subscribe', async () => {
  const staffUser = { name: 'S2', email: 's2@x.io', password: PASSWORD, role: 'staff' };
  assert.equal((await call('staff', 'POST', '/users', staffUser)).status, 403);
  assert.equal((await call('staff', 'POST', '/subscriptions/subscribe', { plan_id: 1, lines: [{ product_id: 1, quantity: 1 }] })).status, 403);
  assert.equal((await call('staff', 'PUT', `/subscriptions/${ids.aliceSub}/discount`, { discount_id: null })).status, 200);
  assert.equal((await call('alice', 'PUT', `/subscriptions/${ids.aliceSub}/discount`, { discount_id: null })).status, 403);
});

test('online payments report disabled without gateway keys', async () => {
  assert.deepEqual((await call('alice', 'GET', '/payments/online/status')).body, { enabled: false });
});

test('changing a password keeps this session and signs out the others', async () => {
  await login('alice2', 'alice@x.io');
  const wrong = await call('alice', 'POST', '/auth/change-password', { current_password: 'nope', new_password: 'Another#pass2' });
  assert.equal(wrong.status, 400);
  assert.equal((await call('alice', 'POST', '/auth/change-password', { current_password: PASSWORD, new_password: 'Another#pass2' })).status, 200);
  assert.equal((await call('alice', 'GET', '/auth/me')).body.email, 'alice@x.io');
  assert.equal((await call('alice2', 'GET', '/auth/me')).body, null);
});

test('deactivated accounts are signed out and cannot sign in', async () => {
  assert.equal((await call('admin', 'PUT', `/users/${ids.admin}/active`, { active: false })).status, 409);
  assert.equal((await call('admin', 'PUT', `/users/${ids.bob}/active`, { active: false })).status, 200);
  assert.equal((await call('bob', 'GET', '/auth/me')).body, null);
  const denied = await login('bob', 'bob@x.io');
  assert.equal(denied.status, 403);
  assert.match(denied.body.error, /deactivated/);
});

test('login attempts are rate limited', async () => {
  let last;
  for (let i = 0; i < 25; i += 1) last = await login(null, 'nobody@x.io', 'Wrong#pass1');
  assert.equal(last.status, 429);
});

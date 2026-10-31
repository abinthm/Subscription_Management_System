import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ??= 'postgres://localhost:5432/subscriptions_test';
const { pool, query } = await import('../src/db/pool.js');
const { migrate, status } = await import('../src/db/migrate.js');

const quiet = { log: () => {} };

before(async () => {
  await query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
});

after(() => pool.end());

test('instances starting together apply each migration exactly once', async () => {
  await Promise.all([migrate(quiet), migrate(quiet), migrate(quiet)]);
  const { rows } = await query('SELECT count(*)::int AS n, count(DISTINCT name)::int AS d, bool_and(checksum IS NOT NULL) AS summed FROM schema_migrations');
  assert.equal(rows[0].n, rows[0].d);
  assert.ok(rows[0].n >= 9);
  assert.equal(rows[0].summed, true);
  assert.ok((await status()).every((m) => m.state === 'applied'));
});

test('a migration edited after it was applied stops startup', async () => {
  await query("UPDATE schema_migrations SET checksum = 'stale' WHERE name = '001_init.sql'");
  await assert.rejects(migrate(quiet), /001_init\.sql was edited after it was applied/);
  assert.equal((await status()).find((m) => m.migration === '001_init.sql').state, 'EDITED AFTER APPLY');
});

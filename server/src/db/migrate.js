import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { pool } from './pool.js';
import { config } from '../config.js';

const dir = new URL('./migrations/', import.meta.url);
const MIGRATION_LOCK = 7_243_100;
const NAME = /^(\d{3})_[a-z0-9_]+\.sql$/;

const checksum = (sql) => createHash('sha256').update(sql).digest('hex');

async function migrationFiles() {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const bad = files.filter((f) => !NAME.test(f));
  if (bad.length) throw new Error(`Migration files must be named NNN_description.sql: ${bad.join(', ')}`);
  return Promise.all(files.map(async (name) => {
    const sql = await readFile(new URL(name, dir), 'utf8');
    return { name, sql, checksum: checksum(sql) };
  }));
}

async function ensureTable(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    run_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await db.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT');
  await db.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS duration_ms INT');
}

// Holds an advisory lock for the whole run, so instances starting together migrate once and in order.
// Applied files are checksummed: editing one after it ran is refused, because production already has the old version.
export async function migrate({ log = console.log } = {}) {
  const files = await migrationFiles();
  const db = await pool.connect();
  try {
    await db.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
    await ensureTable(db);
    const { rows } = await db.query('SELECT name, checksum FROM schema_migrations');
    const applied = new Map(rows.map((r) => [r.name, r.checksum]));

    for (const file of files.filter((f) => applied.has(f.name))) {
      const recorded = applied.get(file.name);
      if (!recorded) {
        await db.query('UPDATE schema_migrations SET checksum = $2 WHERE name = $1', [file.name, file.checksum]);
      } else if (recorded !== file.checksum) {
        throw new Error(`${file.name} was edited after it was applied. Revert it and add a new migration instead.`);
      }
    }

    for (const file of files.filter((f) => !applied.has(f.name))) {
      const started = Date.now();
      await db.query('BEGIN');
      try {
        await db.query(file.sql);
        await db.query(
          'INSERT INTO schema_migrations (name, checksum, duration_ms) VALUES ($1, $2, $3)',
          [file.name, file.checksum, Date.now() - started],
        );
        await db.query('COMMIT');
        log(`migrated ${file.name} (${Date.now() - started} ms)`);
      } catch (err) {
        await db.query('ROLLBACK');
        throw new Error(`${file.name} failed and was rolled back: ${err.message}`);
      }
    }
  } finally {
    await db.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => {});
    db.release();
  }
}

export async function status() {
  const files = await migrationFiles();
  await ensureTable(pool);
  const { rows } = await pool.query('SELECT name, checksum, run_at, duration_ms FROM schema_migrations');
  const applied = new Map(rows.map((r) => [r.name, r]));
  return files.map((f) => {
    const row = applied.get(f.name);
    let state = 'pending';
    if (row) state = row.checksum && row.checksum !== f.checksum ? 'EDITED AFTER APPLY' : 'applied';
    return { migration: f.name, state, applied_at: row?.run_at?.toLocaleString('sv-SE', { timeZone: config.timezone }) ?? '', ms: row?.duration_ms ?? '' };
  });
}

export async function create(description) {
  const slug = String(description ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  if (!slug) throw new Error('Usage: npm run migrate:create -- <description>');
  const files = await migrationFiles();
  const next = String(files.length ? Number(files.at(-1).name.slice(0, 3)) + 1 : 1).padStart(3, '0');
  const name = `${next}_${slug}.sql`;
  await writeFile(new URL(name, dir), '', { flag: 'wx' });
  return name;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [command = 'up', ...args] = process.argv.slice(2);
  const run = {
    up: () => migrate(),
    status: async () => console.table(await status()),
    create: async () => console.log(`created src/db/migrations/${await create(args.join(' '))}`),
  }[command];
  if (!run) {
    console.error('Usage: node src/db/migrate.js [up|status|create <description>]');
    process.exit(1);
  }
  run().then(() => pool.end()).catch((err) => { console.error(err.message); process.exit(1); });
}

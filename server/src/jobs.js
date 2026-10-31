import { pool, query } from './db/pool.js';
import { runBilling, sendOverdueReminders } from './modules/invoices/service.js';
import { activateDue, closeExpired, expireQuotations } from './modules/subscriptions/service.js';
import { refreshSnapshots } from './modules/insights/service.js';
import { publish } from './lib/events.js';

const HOUR = 60 * 60_000;
const JOB_LOCK = 7_243_101;

async function purgeExpired() {
  const [sessions, resets, limits] = await Promise.all([
    query('DELETE FROM sessions WHERE expires_at < now()'),
    query("DELETE FROM password_resets WHERE expires_at < now() - interval '1 day'"),
    query("DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'"),
  ]);
  return sessions.rowCount + resets.rowCount + limits.rowCount;
}

// The advisory lock lets any number of API instances run this timer while only one does the work.
export async function runDailyJobs() {
  const lock = await pool.connect();
  try {
    const { rows } = await lock.query('SELECT pg_try_advisory_lock($1) AS acquired', [JOB_LOCK]);
    if (!rows[0].acquired) return null;
    try {
      const activated = await activateDue();
      const closed = await closeExpired() + await expireQuotations();
      const billing = await runBilling();
      if (activated || closed) publish('subscriptions');
      if (billing.created) publish('invoices');
      const reminded = await sendOverdueReminders();
      const purged = await purgeExpired();
      const snapshots = await refreshSnapshots({ recentMonths: 2 });
      console.log(`[jobs] activated=${activated} closed=${closed} invoiced=${billing.created} failed=${billing.failed.length} reminded=${reminded} purged=${purged} snapshots=${snapshots}`);
      return { activated, closed, ...billing, reminded, purged, snapshots };
    } finally {
      await lock.query('SELECT pg_advisory_unlock($1)', [JOB_LOCK]);
    }
  } finally {
    lock.release();
  }
}

export function startJobs() {
  const tick = () => runDailyJobs().catch((err) => console.error('[jobs] failed', err));
  tick();
  return setInterval(tick, HOUR).unref();
}

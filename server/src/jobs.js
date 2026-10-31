import { runBilling, sendOverdueReminders } from './modules/invoices/service.js';
import { activateDue, closeExpired } from './modules/subscriptions/service.js';
import { publish } from './lib/events.js';

const HOUR = 60 * 60_000;

export async function runDailyJobs() {
  const activated = await activateDue();
  const closed = await closeExpired();
  const billing = await runBilling();
  if (activated || closed) publish('subscriptions');
  if (billing.created) publish('invoices');
  const reminded = await sendOverdueReminders();
  console.log(`[jobs] activated=${activated} closed=${closed} invoiced=${billing.created} failed=${billing.failed.length} reminded=${reminded}`);
  return { activated, closed, ...billing, reminded };
}

// NOTE: single-process timer; use pg advisory lock or a real scheduler once more than one instance runs
export function startJobs() {
  const tick = () => runDailyJobs().catch((err) => console.error('[jobs] failed', err));
  tick();
  return setInterval(tick, HOUR).unref();
}

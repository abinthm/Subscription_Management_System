import { config } from '../config.js';

const businessDate = new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit' });

export const today = () => businessDate.format(new Date());

const toDate = (iso) => new Date(`${iso}T00:00:00Z`);
const toIso = (d) => d.toISOString().slice(0, 10);

export function addDays(iso, days) {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toIso(d);
}

function addMonths(iso, months) {
  const d = toDate(iso);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return toIso(d);
}

export function addPeriod(iso, period, count = 1) {
  switch (period) {
    case 'daily': return addDays(iso, count);
    case 'weekly': return addDays(iso, 7 * count);
    case 'monthly': return addMonths(iso, count);
    case 'yearly': return addMonths(iso, 12 * count);
    default: throw new Error(`Unknown billing period: ${period}`);
  }
}

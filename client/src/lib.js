const currency = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', notation: 'compact', maximumFractionDigits: 1 });
const dateFmt = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

export const money = (n) => currency.format(Number(n ?? 0));
export const moneyShort = (n) => compact.format(Number(n ?? 0));
export const date = (iso) => (iso ? dateFmt.format(new Date(iso.length === 10 ? `${iso}T00:00:00` : iso)) : '—');
export const today = () => new Date().toLocaleDateString('en-CA');
export const label = (s) => String(s ?? '').replace(/_/g, ' ');
export const initials = (name = '') => name.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('');

export const STATUS_TONE = {
  draft: '', quotation: 'blue', confirmed: 'teal', active: 'green', paused: 'amber', closed: '',
  paid: 'green', cancelled: 'red', overdue: 'red',
};

export const PASSWORD_RULES = [
  ['More than 8 characters', (p) => p.length > 8],
  ['An uppercase letter', (p) => /[A-Z]/.test(p)],
  ['A lowercase letter', (p) => /[a-z]/.test(p)],
  ['A special character', (p) => /[^A-Za-z0-9]/.test(p)],
];

export const PERIOD_UNIT = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' };

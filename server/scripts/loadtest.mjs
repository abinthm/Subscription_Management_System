// Usage: node scripts/loadtest.mjs [baseUrl] [concurrency] [seconds]
const [base = 'http://localhost:4000', concurrency = '50', seconds = '20'] = process.argv.slice(2);
const email = process.env.LOADTEST_EMAIL ?? 'admin@brightloop.io';
const password = process.env.LOADTEST_PASSWORD ?? 'Admin@1234';

const login = await fetch(`${base}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
if (!login.ok) throw new Error(`Login failed: ${login.status}`);
const cookie = login.headers.getSetCookie()[0].split(';')[0];

const pickId = (max) => 1 + Math.floor(Math.random() * max);
const MIX = [
  ['dashboard', 2, () => '/api/reports/summary'],
  ['growth', 1, () => '/api/insights/growth'],
  ['subscription list', 3, () => '/api/subscriptions?status=active'],
  ['invoice search', 2, () => '/api/invoices?q=ra'],
  ['subscription page', 4, () => `/api/subscriptions/${pickId(2400)}`],
  ['invoice page', 4, () => `/api/invoices/${pickId(14000)}`],
  ['payments list', 2, () => '/api/payments'],
];
const weighted = MIX.flatMap((m) => Array(m[1]).fill(m));

const stats = new Map(MIX.map(([name]) => [name, { times: [], errors: 0 }]));
const deadline = Date.now() + Number(seconds) * 1000;

async function client() {
  while (Date.now() < deadline) {
    const [name, , path] = weighted[Math.floor(Math.random() * weighted.length)];
    const started = performance.now();
    try {
      const res = await fetch(base + path(), { headers: { Cookie: cookie } });
      await res.arrayBuffer();
      const s = stats.get(name);
      if (res.status >= 500 || res.status === 429) s.errors += 1;
      else s.times.push(performance.now() - started);
    } catch {
      stats.get(name).errors += 1;
    }
  }
}

const startedAt = performance.now();
await Promise.all(Array.from({ length: Number(concurrency) }, client));
const elapsed = (performance.now() - startedAt) / 1000;

const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0);
const row = (name, times, errors) => {
  const sorted = [...times].sort((a, b) => a - b);
  return {
    endpoint: name,
    requests: times.length,
    'req/s': Math.round(times.length / elapsed),
    'p50 ms': Math.round(pct(sorted, 50)),
    'p95 ms': Math.round(pct(sorted, 95)),
    'p99 ms': Math.round(pct(sorted, 99)),
    errors,
  };
};
const all = [...stats.values()];
console.log(`${concurrency} concurrent clients for ${elapsed.toFixed(1)}s against ${base}`);
console.table([
  ...[...stats].map(([name, s]) => row(name, s.times, s.errors)),
  row('ALL', all.flatMap((s) => s.times), all.reduce((n, s) => n + s.errors, 0)),
]);

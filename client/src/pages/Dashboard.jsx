import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '../hooks/useQuery.js';
import { Card, PageHead, Loadable, Empty, Input } from '../components/ui.jsx';
import { qs } from '../api/client.js';
import { date, money, moneyShort, today } from '../lib.js';

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

function Stat({ label, value, hint, tone }) {
  return (
    <div className={`card stat ${tone ?? ''}`}>
      <div className="label">{label}</div>
      <div className="value mono">{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

function TrendChart({ trend }) {
  const max = Math.max(1, ...trend.flatMap((t) => [t.revenue, t.invoiced]));
  return (
    <>
      <div className="bars" role="img" aria-label="Invoiced versus collected for the last six months">
        {trend.map((t) => (
          <div className="bar-col" key={t.month} title={`${t.month}: invoiced ${money(t.invoiced)}, collected ${money(t.revenue)}`}>
            <div className="bar-pair">
              <div className="bar invoiced" style={{ height: `${(t.invoiced / max) * 100}%` }} />
              <div className="bar revenue" style={{ height: `${(t.revenue / max) * 100}%` }} />
            </div>
            <span className="bar-label">{new Date(`${t.month}-01T00:00:00`).toLocaleString('en', { month: 'short' })}</span>
          </div>
        ))}
      </div>
      <div className="legend" style={{ marginTop: 12 }}><span className="l-inv">Invoiced</span><span className="l-rev">Collected</span></div>
    </>
  );
}

export default function Dashboard() {
  const [range, setRange] = useState({ from: daysAgo(30), to: today() });
  const navigate = useNavigate();
  const summary = useQuery(`/reports/summary${qs(range)}`, { topics: ['invoices', 'payments', 'subscriptions'] });

  return (
    <>
      <PageHead title="Dashboard" subtitle="Live view of subscriptions, revenue and collections.">
        <Input label="From" type="date" value={range.from} max={range.to} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
        <Input label="To" type="date" value={range.to} min={range.from} max={today()} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
      </PageHead>
      <Loadable query={summary}>
        {(s) => {
          const totalSubs = Object.values(s.subscriptions).reduce((a, b) => a + b, 0);
          const maxPlan = Math.max(1, ...s.by_plan.map((p) => p.active));
          return (
            <div className="stack">
              <div className="grid grid-4">
                <Stat label="Active subscriptions" value={s.active_subscriptions.toLocaleString()} hint={`${totalSubs.toLocaleString()} in total`} />
                <Stat label="Monthly recurring revenue" value={moneyShort(s.mrr)} hint="Normalised across billing periods" />
                <Stat label="Collected in range" value={moneyShort(s.revenue)} hint={`${s.payment_count} payments · ${moneyShort(s.invoiced)} invoiced`} />
                <Stat label="Overdue" value={moneyShort(s.overdue.amount)} hint={`${s.overdue.count} invoices · ${moneyShort(s.outstanding)} outstanding`} tone="danger" />
              </div>

              <div className="split">
                <Card title="Invoiced vs collected" actions={<span className="muted small">Last 6 months</span>}>
                  <TrendChart trend={s.trend} />
                </Card>
                <Card title="Active by plan">
                  {s.by_plan.length ? s.by_plan.map((p) => (
                    <div key={p.name} style={{ marginBottom: 14 }}>
                      <div className="row" style={{ justifyContent: 'space-between' }}><span>{p.name}</span><strong className="mono">{p.active}</strong></div>
                      <div className="meter"><i style={{ width: `${(p.active / maxPlan) * 100}%` }} /></div>
                    </div>
                  )) : <Empty title="No plans yet" />}
                </Card>
              </div>

              <Card title="Overdue invoices" flush actions={<Link className="btn btn-sm" to="/invoices?overdue=true">View all</Link>}>
                {s.overdue_invoices.length ? (
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>Invoice</th><th>Customer</th><th>Due</th><th className="num">Days late</th><th className="num">Balance</th></tr></thead>
                      <tbody>
                        {s.overdue_invoices.map((i) => (
                          <tr key={i.id} className="clickable" onClick={() => navigate(`/invoices/${i.id}`)}>
                            <td><Link to={`/invoices/${i.id}`}>{i.number}</Link></td>
                            <td>{i.customer_name}</td>
                            <td>{date(i.due_date)}</td>
                            <td className="num">{i.days_overdue}</td>
                            <td className="num">{money(i.balance)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <Empty title="Nothing overdue">Every confirmed invoice is within its payment terms.</Empty>}
              </Card>
            </div>
          );
        }}
      </Loadable>
    </>
  );
}

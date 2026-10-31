import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '../hooks/useQuery.js';
import { Card, PageHead, Loadable, Empty, Badge } from '../components/ui.jsx';
import { ForecastChart, MovementChart, ScenarioChart, MOVEMENTS } from '../components/charts.jsx';
import { money, moneyShort } from '../lib.js';

const pct = (n, dp = 1) => (n === null || n === undefined ? '—' : `${(n * 100).toFixed(dp)}%`);
const signedPct = (n) => (n === null || n === undefined ? '—' : `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%`);

function project(d, months) {
  const out = [];
  let mrr = d.mrr;
  for (let m = 0; m < months; m += 1) {
    mrr = Math.max(mrr * (1 + d.expansionRate - d.contractionRate - d.churnRate) + d.newMrr, 0);
    out.push(mrr);
  }
  return out;
}

function Kpi({ label, value, hint, tone }) {
  return (
    <div className={`card stat ${tone ?? ''}`}>
      <div className="label">{label}</div>
      <div className="value mono">{value}</div>
      <div className="hint">{hint}</div>
    </div>
  );
}

function Simulator({ drivers, forecastStart }) {
  const [churnCut, setChurnCut] = useState(20);
  const [newLift, setNewLift] = useState(100);
  const [expansionAdd, setExpansionAdd] = useState(0.5);

  const months = useMemo(() => {
    const start = new Date(`${forecastStart}-01T00:00:00Z`);
    return Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1)).toISOString().slice(0, 7));
  }, [forecastStart]);

  const scenarioDrivers = {
    ...drivers,
    churnRate: drivers.churnRate * (1 - churnCut / 100),
    newMrr: drivers.newMrr * (newLift / 100),
    expansionRate: drivers.expansionRate + expansionAdd / 100,
  };
  const baseline = project(drivers, 12);
  const scenario = project(scenarioDrivers, 12);
  const extraRevenue = scenario.reduce((s, v, i) => s + v - baseline[i], 0);
  const tenPctChurn = project({ ...drivers, churnRate: drivers.churnRate * 0.9 }, 12).at(-1) - baseline.at(-1);

  return (
    <div className="split">
      <Card title="Current trend vs your scenario" actions={<span className="muted small">Next 12 months</span>}>
        <ScenarioChart months={months} baseline={baseline} scenario={scenario} label="Projected MRR, current trend versus scenario" />
        <div className="legend" style={{ marginTop: 12 }}><span className="l-base">Current trend</span><span className="l-scn">Scenario</span></div>
      </Card>
      <Card title="Growth levers">
        <div className="lever">
          <label htmlFor="churn">Reduce churn by <strong>{churnCut}%</strong></label>
          <input id="churn" type="range" min="0" max="60" step="5" value={churnCut} onChange={(e) => setChurnCut(Number(e.target.value))} />
          <small className="muted">{pct(drivers.churnRate, 2)} → {pct(scenarioDrivers.churnRate, 2)} of MRR lost per month</small>
        </div>
        <div className="lever">
          <label htmlFor="new">New business at <strong>{newLift}%</strong> of today</label>
          <input id="new" type="range" min="50" max="200" step="10" value={newLift} onChange={(e) => setNewLift(Number(e.target.value))} />
          <small className="muted">{moneyShort(drivers.newMrr)} → {moneyShort(scenarioDrivers.newMrr)} new MRR per month</small>
        </div>
        <div className="lever">
          <label htmlFor="exp">Extra expansion <strong>+{expansionAdd.toFixed(1)} pts</strong></label>
          <input id="exp" type="range" min="0" max="3" step="0.5" value={expansionAdd} onChange={(e) => setExpansionAdd(Number(e.target.value))} />
          <small className="muted">{pct(drivers.expansionRate, 2)} → {pct(scenarioDrivers.expansionRate, 2)} upsell per month</small>
        </div>
        <dl className="dl" style={{ marginTop: 18 }}>
          <dt>MRR in 12 months</dt><dd className="mono">{moneyShort(scenario.at(-1))} <span className="muted small">vs {moneyShort(baseline.at(-1))}</span></dd>
          <dt>ARR difference</dt><dd className="mono">{(scenario.at(-1) - baseline.at(-1)) >= 0 ? '+' : '−'}{moneyShort(Math.abs(scenario.at(-1) - baseline.at(-1)) * 12)}</dd>
          <dt>Extra revenue this year</dt><dd className="mono">{extraRevenue >= 0 ? '+' : '−'}{moneyShort(Math.abs(extraRevenue))}</dd>
        </dl>
        <p className="muted small" style={{ marginBottom: 0 }}>Every 10% cut in churn is worth about <strong>{moneyShort(tenPctChurn * 12)}</strong> of ARR a year from now.</p>
      </Card>
    </div>
  );
}

export default function Growth() {
  const navigate = useNavigate();
  const growth = useQuery('/insights/growth', { topics: ['invoices', 'subscriptions', 'payments'] });
  const [showTable, setShowTable] = useState(false);

  return (
    <>
      <PageHead
        title="Growth"
        subtitle="Where recurring revenue comes from, where it leaks, and where it is heading. Every figure is computed from billed invoices; nothing is guessed."
      />
      <Loadable query={growth}>
        {(g) => {
          if (!g.months.some((m) => Number(m.mrr) > 0)) return <Card><Empty title="Not enough history yet">Insights appear once subscriptions have been billed.</Empty></Card>;
          const k = g.kpis;
          const last12 = g.months.slice(-12);
          const history = g.months.filter((m) => Number(m.mrr) > 0).slice(-12).map((m) => ({ month: m.month, value: Number(m.mrr) }));
          return (
            <div className="stack">
              <div className="grid grid-4 kpi-grid">
                <Kpi label="Monthly recurring revenue" value={moneyShort(k.mrr)} hint={`${signedPct(k.mom_growth)} vs last month · ARR ${moneyShort(k.arr)}`} />
                <Kpi label="Net revenue retention" value={pct(k.net_retention, 0)} hint="Revenue kept from existing customers over a year, upsell included" tone={k.net_retention !== null && k.net_retention < 1 ? 'warn' : ''} />
                <Kpi label="Quick ratio" value={k.quick_ratio ?? '—'} hint="(New + expansion) ÷ (contraction + churn), last 3 months. Above 4 is excellent" />
                <Kpi label="Customer churn" value={pct(k.customer_churn)} hint={`Per month, last 3 months · revenue churn ${pct(k.revenue_churn)}`} />
                <Kpi label="Average revenue per account" value={moneyShort(k.arpa)} hint={`${k.customers.toLocaleString()} paying customers`} />
                <Kpi label="Gross margin" value={pct(k.gross_margin, 0)} hint="From product cost prices on active subscriptions" />
                <Kpi label="Customer lifetime value" value={k.ltv ? moneyShort(k.ltv) : '—'} hint="ARPA × gross margin ÷ monthly churn" />
                <Kpi label="Days sales outstanding" value={k.dso ?? '—'} hint={`Customers pay in ${k.days_to_pay ?? '—'} days on average`} />
              </div>

              <Card
                title="MRR movements"
                actions={<button type="button" className="btn btn-sm" onClick={() => setShowTable((v) => !v)}>{showTable ? 'Show chart' : 'Show table'}</button>}
              >
                {showTable ? (
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>Month</th>{MOVEMENTS.map((m) => <th key={m.key} className="num">{m.label}</th>)}<th className="num">Net</th><th className="num">MRR</th></tr></thead>
                      <tbody>
                        {last12.map((m) => (
                          <tr key={m.month}>
                            <td>{m.month}</td>
                            {MOVEMENTS.map((mv) => <td key={mv.key} className="num">{mv.sign < 0 && Number(m[mv.key]) ? '−' : ''}{money(m[mv.key])}</td>)}
                            <td className="num">{money(Number(m.new) + Number(m.expansion) - Number(m.contraction) - Number(m.churned))}</td>
                            <td className="num">{money(m.mrr)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <>
                    <MovementChart months={last12} label="Monthly MRR gained from new and expanding customers and lost to contraction and churn" />
                    <div className="legend" style={{ marginTop: 12 }}>
                      {MOVEMENTS.map((mv) => <span key={mv.key}><i className={`swatch ${mv.cls}`} />{mv.label}</span>)}
                    </div>
                  </>
                )}
              </Card>

              {g.forecast && (
                <Card
                  title="MRR forecast"
                  actions={<span className="muted small">{g.forecast.method} · typical error {pct(g.forecast.typical_error)}</span>}
                >
                  <ForecastChart history={history} forecast={g.forecast.points} label="MRR for the last 12 months and forecast for the next 6 months with an 80% range" />
                  <p className="muted small" style={{ margin: '12px 0 0' }}>
                    Solid line is billed MRR; dashed line is the forecast with its 80% range shaded.
                    Expected MRR in {g.forecast.points.at(-1).month}: <strong>{moneyShort(g.forecast.points.at(-1).value)}</strong>.
                    The model is fitted on this account's own history, so the same data always gives the same forecast.
                  </p>
                </Card>
              )}

              <Simulator drivers={g.drivers} forecastStart={g.forecast?.points[0].month ?? g.months.at(-1).month} />

              <Card
                title={<span className="row">Revenue at risk <Badge tone="red">{moneyShort(g.at_risk.mrr)} MRR</Badge></span>}
                flush
                actions={<span className="muted small">{g.at_risk.customers} customers flagged by payment, pause, contraction and renewal signals</span>}
              >
                {g.at_risk.top.length ? (
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>Customer</th><th>Risk</th><th>Why</th><th className="num">MRR at stake</th></tr></thead>
                      <tbody>
                        {g.at_risk.top.map((r) => (
                          <tr key={r.customer_id} className="clickable" onClick={() => navigate(`/customers/${r.customer_id}`)}>
                            <td><Link to={`/customers/${r.customer_id}`}>{r.name}</Link></td>
                            <td><Badge tone={r.level === 'high' ? 'red' : 'amber'}>{r.level}</Badge></td>
                            <td className="muted reasons">{r.reasons.join(' · ')}</td>
                            <td className="num">{money(r.mrr)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <Empty title="No customers at risk">No overdue, paused, shrinking or expiring accounts right now.</Empty>}
              </Card>
            </div>
          );
        }}
      </Loadable>
    </>
  );
}

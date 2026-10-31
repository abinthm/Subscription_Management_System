import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useAuth, isTeam } from '../../hooks/auth.jsx';
import { useQuery } from '../../hooks/useQuery.js';
import { useToast } from '../../hooks/toast.jsx';
import { Card, PageHead, Loadable, StatusBadge, Empty } from '../../components/ui.jsx';
import { date, label, money, PERIOD_UNIT } from '../../lib.js';

const FLOW = ['draft', 'quotation', 'confirmed', 'active', 'closed'];

function Stepper({ status }) {
  const at = status === 'paused' ? FLOW.indexOf('active') : FLOW.indexOf(status);
  return (
    <div className="stepper" aria-label={`Status: ${status}`}>
      {FLOW.map((s, i) => (
        <div key={s} className={`step ${i < at ? 'done' : ''} ${i === at ? 'current' : ''}`}>
          {s === 'active' && status === 'paused' ? 'Paused' : label(s)}
        </div>
      ))}
    </div>
  );
}

function actionsFor(sub, team) {
  const { plan, status } = sub;
  const list = [];
  const add = (action, text, tone = '', confirm) => list.push({ action, text, tone, confirm });
  if (team && status === 'draft') add('send', 'Send quotation', 'btn-primary');
  if (status === 'quotation' || (team && status === 'draft')) add('confirm', team ? 'Confirm' : 'Accept quotation', team && status === 'draft' ? '' : 'btn-primary');
  if (team && status === 'confirmed') add('activate', 'Activate', 'btn-primary');
  if (status === 'active' && plan.pausable) add('pause', 'Pause');
  if (status === 'paused') add('resume', 'Resume', 'btn-primary');
  if (status === 'active' && plan.renewable && sub.expiry_date) add('renew', 'Renew');
  const early = ['active', 'paused'].includes(status);
  if (status !== 'closed' && (!early || plan.closable) && (team || early)) {
    add('close', early ? 'Close subscription' : 'Cancel quotation', 'btn-danger', `Close ${sub.number}? This cannot be undone.`);
  }
  return list;
}

export default function SubscriptionDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const team = isTeam(user);
  const notify = useToast();
  const navigate = useNavigate();
  const sub = useQuery(`/subscriptions/${id}`, { topics: ['subscriptions'] });
  const [busy, setBusy] = useState('');

  const run = async (action, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(action);
    try {
      sub.setData(await api.post(`/subscriptions/${id}/${action}`));
      notify(`Subscription ${action === 'renew' ? 'renewed' : 'updated'}`);
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const invoiceNow = async () => {
    setBusy('invoice');
    try {
      const invoice = await api.post(`/invoices/from-subscription/${id}`);
      notify(`Invoice ${invoice.number} created`);
      navigate(`/invoices/${invoice.id}`);
    } catch (err) {
      notify(err.message, 'error');
      setBusy('');
    }
  };

  return (
    <Loadable query={sub}>
      {(s) => (
        <>
          <PageHead
            crumb={<Link to={team ? '/subscriptions' : '/'}>Subscriptions</Link>}
            title={<span className="row">{s.number} <StatusBadge status={s.status} /></span>}
            subtitle={`${s.customer_name} · ${s.plan.name}`}
          >
            {team && ['draft', 'quotation'].includes(s.status) && <Link className="btn" to={`/subscriptions/${s.id}/edit`}>Edit</Link>}
            {team && s.status === 'active' && (
              <button type="button" className="btn btn-accent" disabled={Boolean(busy)} onClick={invoiceNow}>
                {busy === 'invoice' ? 'Creating…' : 'Create invoice'}
              </button>
            )}
            {actionsFor(s, team).map((a) => (
              <button key={a.action} type="button" className={`btn ${a.tone}`} disabled={Boolean(busy)} onClick={() => run(a.action, a.confirm)}>
                {busy === a.action ? 'Working…' : a.text}
              </button>
            ))}
          </PageHead>

          <div className="stack">
            <Card><Stepper status={s.status} /></Card>

            <div className="split">
              <Card title="Order lines" flush>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Product</th><th className="num">Qty</th><th className="num">Unit price</th><th>Tax</th><th className="num">Discount</th><th className="num">Amount</th></tr></thead>
                    <tbody>
                      {s.lines.map((l) => (
                        <tr key={l.id}>
                          <td>{l.product_name}{l.variant_label && <div className="muted small">{l.variant_label}</div>}</td>
                          <td className="num">{l.quantity}</td>
                          <td className="num">{money(l.unit_price)}</td>
                          <td>{l.tax_name ?? '—'}</td>
                          <td className="num">{l.discount_amount ? `−${money(l.discount_amount)}` : '—'}</td>
                          <td className="num">{money(l.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="card-body">
                  <div className="totals">
                    <div><span className="muted">Subtotal</span><span className="mono">{money(s.totals.subtotal)}</span></div>
                    {s.totals.discount_total > 0 && <div><span className="muted">Discount ({s.discount_name})</span><span className="mono">−{money(s.totals.discount_total)}</span></div>}
                    <div><span className="muted">Tax</span><span className="mono">{money(s.totals.tax_total)}</span></div>
                    <div className="grand"><span>Per {PERIOD_UNIT[s.plan.billing_period]}</span><span className="mono">{money(s.totals.total)}</span></div>
                  </div>
                </div>
              </Card>

              <Card title="Details">
                <dl className="dl">
                  <dt>Customer</dt><dd>{team ? <Link to={`/customers/${s.customer_id}`}>{s.customer_name}</Link> : s.customer_name}</dd>
                  <dt>Plan</dt><dd>{s.plan.name} · {s.plan.billing_period}</dd>
                  <dt>Start date</dt><dd>{date(s.start_date)}</dd>
                  <dt>Expiry date</dt><dd>{date(s.expiry_date)}</dd>
                  {s.valid_until && ['draft', 'quotation'].includes(s.status) && <><dt>Quote valid until</dt><dd>{date(s.valid_until)}</dd></>}
                  {s.status === 'active' && <><dt>Next invoice</dt><dd>{date(s.next_invoice_date)}</dd></>}
                  <dt>Payment terms</dt><dd>{s.payment_terms_days} days</dd>
                  <dt>Discount</dt><dd>{s.discount_name ?? '—'}</dd>
                  <dt>Plan rules</dt>
                  <dd className="small muted">
                    {[s.plan.auto_close && 'auto-closes at expiry', s.plan.pausable && 'pausable', s.plan.renewable && 'renewable', s.plan.closable && 'closable early']
                      .filter(Boolean).join(' · ') || 'fixed term'}
                  </dd>
                </dl>
                {s.notes && <p className="muted" style={{ marginBottom: 0 }}>{s.notes}</p>}
              </Card>
            </div>

            <Card title="Invoices" flush>
              {s.invoices.length ? (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Number</th><th>Period</th><th>Due</th><th>Status</th><th className="num">Total</th><th className="num">Paid</th></tr></thead>
                    <tbody>
                      {s.invoices.map((i) => (
                        <tr key={i.id} className="clickable" onClick={() => navigate(`/invoices/${i.id}`)}>
                          <td><Link to={`/invoices/${i.id}`}>{i.number}</Link></td>
                          <td>{date(i.period_start)} – {date(i.period_end)}</td>
                          <td>{date(i.due_date)}</td>
                          <td><StatusBadge status={i.status} /></td>
                          <td className="num">{money(i.total)}</td>
                          <td className="num">{money(i.amount_paid)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <Empty title="No invoices yet">Invoices are created automatically on each billing date once the subscription is active.</Empty>}
            </Card>
          </div>
        </>
      )}
    </Loadable>
  );
}

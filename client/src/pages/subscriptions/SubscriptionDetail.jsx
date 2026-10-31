import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useAuth, isTeam } from '../../hooks/auth.jsx';
import { useQuery } from '../../hooks/useQuery.js';
import { useToast } from '../../hooks/toast.jsx';
import { Card, PageHead, Loadable, StatusBadge, Empty, Modal, FormError, Spinner, useForm } from '../../components/ui.jsx';
import Timeline from '../../components/Timeline.jsx';
import LinesEditor, { toLinePayload } from '../../components/LinesEditor.jsx';
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

function EditLines({ sub, onDone, onCancel }) {
  const notify = useToast();
  const products = useQuery('/catalog/products', { topics: ['products'] });
  const form = useForm({
    lines: sub.lines.filter((l) => l.product_id).map((l) => ({
      product_id: String(l.product_id),
      variant_id: l.variant_id ? String(l.variant_id) : '',
      quantity: l.quantity,
    })),
  });
  const onSubmit = form.submit(async (v) => {
    onDone(await api.put(`/subscriptions/${sub.id}/lines`, { lines: toLinePayload(v.lines) }));
    notify('Products updated');
  });
  if (!products.data) return <Spinner />;
  return (
    <form className="form-grid" onSubmit={onSubmit} noValidate>
      <FormError error={form.formError} />
      <LinesEditor lines={form.values.lines} products={products.data} onChange={form.set('lines')} minQuantity={sub.plan.min_quantity} error={form.errors.lines} />
      <p className="full muted small" style={{ margin: 0 }}>Changes apply from the next invoice ({date(sub.next_invoice_date)}). Invoices already issued stay as they are.</p>
      <div className="full form-actions">
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary" disabled={form.busy}>{form.busy ? 'Saving…' : 'Save products'}</button>
      </div>
    </form>
  );
}

function DiscountControl({ sub, onSaved }) {
  const notify = useToast();
  const discounts = useQuery('/discounts', { topics: ['discounts'] });
  const current = sub.discount_id ? String(sub.discount_id) : '';
  const [value, setValue] = useState(current);
  const [busy, setBusy] = useState(false);
  const options = (discounts.data ?? []).filter((d) => d.usable || String(d.id) === current);

  const save = async () => {
    setBusy(true);
    try {
      onSaved(await api.put(`/subscriptions/${sub.id}/discount`, { discount_id: Number(value) || null }));
      notify(value ? 'Discount applied from the next invoice' : 'Discount removed');
    } catch (err) {
      notify(err.details?.discount_id ?? err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="inline-control">
      <select className="input" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Discount">
        <option value="">No discount</option>
        {options.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
      </select>
      <button type="button" className="btn btn-sm" disabled={busy || value === current} onClick={save}>{busy ? 'Saving…' : 'Apply'}</button>
    </div>
  );
}

export default function SubscriptionDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const team = isTeam(user);
  const notify = useToast();
  const navigate = useNavigate();
  const sub = useQuery(`/subscriptions/${id}`, { topics: ['subscriptions'] });
  const [busy, setBusy] = useState('');
  const [editing, setEditing] = useState(false);

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
            {(s.status === 'active' || (team && s.status === 'paused')) && <button type="button" className="btn" onClick={() => setEditing(true)}>Edit products</button>}
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
                  <dt>Discount</dt><dd>{team && s.status !== 'closed' ? <DiscountControl key={s.discount_id ?? 'none'} sub={s} onSaved={sub.setData} /> : s.discount_name ?? '—'}</dd>
                  <dt>Plan rules</dt>
                  <dd className="small muted">
                    {[s.plan.auto_close && 'auto-closes at expiry', s.plan.pausable && 'pausable', s.plan.renewable && 'renewable', s.plan.closable && 'closable early']
                      .filter(Boolean).join(' · ') || 'fixed term'}
                  </dd>
                </dl>
                {s.notes && <p className="muted" style={{ marginBottom: 0 }}>{s.notes}</p>}
              </Card>
            </div>

            <div className="split">
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
            <Timeline items={s.activity} />
            </div>
          </div>

          {editing && (
            <Modal title={`Edit products on ${s.number}`} wide onClose={() => setEditing(false)}>
              <EditLines sub={s} onCancel={() => setEditing(false)} onDone={(updated) => { sub.setData(updated); setEditing(false); }} />
            </Modal>
          )}
        </>
      )}
    </Loadable>
  );
}

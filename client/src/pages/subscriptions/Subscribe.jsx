import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useQuery } from '../../hooks/useQuery.js';
import { useToast } from '../../hooks/toast.jsx';
import { Card, PageHead, Loadable, Empty, FormError, useForm } from '../../components/ui.jsx';
import LinesEditor, { emptyLine, linePrice, toLinePayload } from '../../components/LinesEditor.jsx';
import { money, PERIOD_UNIT } from '../../lib.js';

export default function Subscribe() {
  const navigate = useNavigate();
  const notify = useToast();
  const plans = useQuery('/catalog/plans', { topics: ['plans'] });
  const products = useQuery('/catalog/products', { topics: ['products'] });
  const form = useForm({ plan_id: '', lines: [emptyLine()] });

  const plan = plans.data?.find((p) => String(p.id) === form.values.plan_id);
  const choosePlan = (p) => form.setValues((v) => ({
    plan_id: String(p.id),
    lines: v.lines.map((l) => ({ ...l, quantity: Math.max(Number(l.quantity) || 1, p.min_quantity) })),
  }));

  const onSubmit = form.submit(async (v) => {
    const sub = await api.post('/subscriptions/subscribe', { plan_id: Number(v.plan_id) || null, lines: toLinePayload(v.lines) });
    notify(`You're subscribed. ${sub.number} is active and your first invoice is ready.`);
    navigate(`/invoices/${sub.invoice_id}`);
  });

  const productTotal = products.data
    ? form.values.lines.reduce((s, l) => s + linePrice(l, products.data) * Number(l.quantity || 0), 0)
    : 0;
  const subtotal = Number(plan?.price ?? 0) + productTotal;

  return (
    <>
      <PageHead crumb={<Link to="/">Subscriptions</Link>} title="Start a subscription" subtitle="Pick a plan and the products you need. It starts today and your first invoice is ready to pay straight away." />
      <Loadable query={plans}>
        {(planList) => (planList.length ? (
          <form className="stack" onSubmit={onSubmit} noValidate>
            <FormError error={form.formError} />
            <Card title="1. Choose a plan">
              <div className="plan-grid" role="radiogroup" aria-label="Plan">
                {planList.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={form.values.plan_id === String(p.id)}
                    className={`plan-card ${form.values.plan_id === String(p.id) ? 'selected' : ''}`}
                    onClick={() => choosePlan(p)}
                  >
                    <span className="plan-name">{p.name}</span>
                    <span className="plan-price">{money(p.price)}<small> / {PERIOD_UNIT[p.billing_period]} + products</small></span>
                    <span className="muted small">
                      {[`min ${p.min_quantity} per product`, p.pausable && 'pause anytime', p.closable && 'cancel anytime', p.auto_close && 'fixed term']
                        .filter(Boolean).join(' · ')}
                    </span>
                  </button>
                ))}
              </div>
              {form.errors.plan_id && <small className="err">Choose a plan to continue</small>}
            </Card>

            <Card title="2. Add products">
              <Loadable query={products}>
                {(productList) => (
                  <LinesEditor lines={form.values.lines} products={productList} onChange={form.set('lines')} minQuantity={plan?.min_quantity ?? 1} error={form.errors.lines} />
                )}
              </Loadable>
            </Card>

            <Card>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div>
                  <div className="muted small">
                    {plan ? `${plan.name} plan ${money(plan.price)} + products ${money(productTotal)}, billed ${plan.billing_period}` : 'Choose a plan'} · taxes added on the invoice
                  </div>
                  <div className="plan-price">{money(subtotal)}{plan && <small> / {PERIOD_UNIT[plan.billing_period]}</small>}</div>
                </div>
                <button className="btn btn-primary" disabled={form.busy || !plan}>{form.busy ? 'Subscribing…' : 'Subscribe and continue to payment'}</button>
              </div>
            </Card>
          </form>
        ) : <Empty title="No plans are available right now" />)}
      </Loadable>
    </>
  );
}

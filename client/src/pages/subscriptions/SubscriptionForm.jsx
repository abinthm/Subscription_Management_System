import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, newIdempotencyKey } from '../../api/client.js';
import { useQuery } from '../../hooks/useQuery.js';
import { useToast } from '../../hooks/toast.jsx';
import { Card, PageHead, Input, Select, Field, FormError, Spinner, useForm } from '../../components/ui.jsx';
import CustomerPicker from '../../components/CustomerPicker.jsx';
import LinesEditor, { emptyLine, toLinePayload } from '../../components/LinesEditor.jsx';
import { money, today } from '../../lib.js';

function FromTemplate({ templates }) {
  const navigate = useNavigate();
  const notify = useToast();
  const form = useForm({ template_id: '', customer_id: '', start_date: today() });

  const onSubmit = form.submit(async (v) => {
    const sub = await api.post('/subscriptions/from-template', { ...v, template_id: Number(v.template_id), customer_id: Number(v.customer_id) });
    notify(`Quotation ${sub.number} created`);
    navigate(`/subscriptions/${sub.id}`);
  });

  if (!templates.length) return <p className="muted" style={{ margin: 0 }}>No templates yet. <Link to="/templates">Create one</Link> to reuse common offers.</p>;
  return (
    <form className="form-grid" onSubmit={onSubmit} noValidate>
      <FormError error={form.formError} />
      <Select label="Template" placeholder="Choose a template" {...form.bind('template_id')}
        options={templates.map((t) => ({ value: t.id, label: `${t.name} · ${t.plan_name} · valid ${t.validity_days} days` }))} />
      <Input label="Start date" type="date" {...form.bind('start_date')} />
      <div className="full"><CustomerPicker value={form.values.customer_id} onChange={form.set('customer_id')} error={form.errors.customer_id} /></div>
      <div className="full form-actions" style={{ marginTop: 0 }}>
        <button className="btn btn-primary" disabled={form.busy}>{form.busy ? 'Creating…' : 'Create quotation'}</button>
      </div>
    </form>
  );
}

export default function SubscriptionForm() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const [idempotencyKey] = useState(newIdempotencyKey);
  const notify = useToast();
  const products = useQuery('/catalog/products');
  const plans = useQuery('/catalog/plans');
  const discounts = useQuery('/discounts');
  const templates = useQuery(editing ? null : '/templates', { enabled: !editing });
  const existing = useQuery(editing ? `/subscriptions/${id}` : null, { enabled: editing });
  const [customerName, setCustomerName] = useState('');

  const form = useForm({
    customer_id: '', plan_id: '', discount_id: '', start_date: today(), expiry_date: '',
    payment_terms_days: 15, valid_until: '', notes: '', lines: [emptyLine()],
  });

  useEffect(() => {
    const s = existing.data;
    if (!s) return;
    setCustomerName(s.customer_name);
    form.setValues({
      customer_id: String(s.customer_id), plan_id: String(s.plan_id), discount_id: s.discount_id ? String(s.discount_id) : '',
      start_date: s.start_date, expiry_date: s.expiry_date ?? '', payment_terms_days: s.payment_terms_days,
      valid_until: s.valid_until ?? '', notes: s.notes ?? '',
      lines: s.lines.map((l) => ({ product_id: String(l.product_id), variant_id: l.variant_id ? String(l.variant_id) : '', quantity: l.quantity })),
    });
  }, [existing.data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!products.data || !plans.data || !discounts.data || (editing && !existing.data)) return <Spinner />;

  const plan = plans.data.find((p) => String(p.id) === String(form.values.plan_id));

  const onSubmit = form.submit(async (v) => {
    const body = {
      ...v,
      customer_id: Number(v.customer_id) || null,
      plan_id: Number(v.plan_id) || null,
      discount_id: Number(v.discount_id) || null,
      payment_terms_days: Number(v.payment_terms_days),
      lines: toLinePayload(v.lines),
    };
    const sub = editing ? await api.put(`/subscriptions/${id}`, body) : await api.post('/subscriptions', body, { idempotencyKey });
    notify(editing ? 'Subscription saved' : `Subscription ${sub.number} created`);
    navigate(`/subscriptions/${sub.id}`);
  });

  return (
    <>
      <PageHead
        crumb={<Link to="/subscriptions">Subscriptions</Link>}
        title={editing ? `Edit ${existing.data.number}` : 'New subscription'}
        subtitle="Prices come from the product catalog; taxes and discounts are applied automatically."
      />
      <div className="stack">
        {!editing && <Card title="Start from a quotation template"><FromTemplate templates={templates.data ?? []} /></Card>}

        <Card title={editing ? 'Subscription' : 'Or build it from scratch'}>
          <form className="form-grid" onSubmit={onSubmit} noValidate>
            <FormError error={form.formError} />
            <div className="full"><CustomerPicker value={form.values.customer_id} initialName={customerName} onChange={form.set('customer_id')} error={form.errors.customer_id} /></div>
            <Select label="Plan" placeholder="Choose a plan" {...form.bind('plan_id')}
              help={plan && `Plan fee ${money(plan.price)} ${plan.billing_period}, added to every invoice · minimum ${plan.min_quantity} per line`}
              options={plans.data.map((p) => ({ value: p.id, label: `${p.name} (${p.billing_period})` }))} />
            <Select label="Discount" placeholder="No discount" {...form.bind('discount_id')}
              options={discounts.data.filter((d) => d.usable || String(d.id) === form.values.discount_id)
                .map((d) => ({ value: d.id, label: `${d.name} · ${d.type === 'percentage' ? `${d.value}%` : money(d.value)} off` }))} />
            <Input label="Start date" type="date" {...form.bind('start_date')} />
            <Input label="Expiry date" type="date" min={form.values.start_date} help="Leave empty for an open-ended subscription" {...form.bind('expiry_date')} />
            <Input label="Payment terms (days)" type="number" min={0} max={180} {...form.bind('payment_terms_days')} />
            <Input label="Quotation valid until" type="date" help="Optional; defaults to 30 days when sent" {...form.bind('valid_until')} />
            <Field label="Order lines" className="full" error={undefined}>
              <LinesEditor lines={form.values.lines} products={products.data} onChange={form.set('lines')} minQuantity={plan?.min_quantity ?? 1} error={form.errors.lines} />
            </Field>
            <Field label="Notes" className="full"><textarea className="input" {...form.bind('notes')} error={undefined} /></Field>
            <div className="full form-actions">
              <Link className="btn" to={editing ? `/subscriptions/${id}` : '/subscriptions'}>Cancel</Link>
              <button className="btn btn-primary" disabled={form.busy}>{form.busy ? 'Saving…' : editing ? 'Save changes' : 'Create draft'}</button>
            </div>
          </form>
        </Card>
      </div>
    </>
  );
}

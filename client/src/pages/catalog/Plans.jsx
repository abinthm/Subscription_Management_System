import { useState } from 'react';
import { api } from '../../api/client.js';
import { useAuth } from '../../hooks/auth.jsx';
import { useQuery } from '../../hooks/useQuery.js';
import { useToast } from '../../hooks/toast.jsx';
import { Card, PageHead, Loadable, Modal, Input, Select, Field, Checkbox, Badge, Empty, FormError, useForm } from '../../components/ui.jsx';
import { date, money, today } from '../../lib.js';

const PERIODS = ['daily', 'weekly', 'monthly', 'yearly'];

function PlanForm({ plan, taxes, onDone }) {
  const notify = useToast();
  const form = useForm({
    name: plan?.name ?? '', price: plan?.price ?? '', tax_id: plan?.tax_id ? String(plan.tax_id) : '', billing_period: plan?.billing_period ?? 'monthly',
    min_quantity: plan?.min_quantity ?? 1, start_date: plan?.start_date ?? today(), end_date: plan?.end_date ?? '',
    auto_close: plan?.auto_close ?? false, closable: plan?.closable ?? true, pausable: plan?.pausable ?? true,
    renewable: plan?.renewable ?? true, active: plan?.active ?? true,
  });
  const onSubmit = form.submit(async (v) => {
    const body = { ...v, price: Number(v.price), tax_id: Number(v.tax_id) || null, min_quantity: Number(v.min_quantity) };
    await (plan ? api.put(`/catalog/plans/${plan.id}`, body) : api.post('/catalog/plans', body));
    notify('Plan saved');
    onDone();
  });
  return (
    <form className="form-grid" onSubmit={onSubmit} noValidate>
      <FormError error={form.formError} />
      <Input label="Name" autoFocus {...form.bind('name')} />
      <Input label="Price" type="number" step="0.01" min="0" help="Billed every period on top of the product lines" {...form.bind('price')} />
      <Select label="Tax on plan fee" placeholder="No tax" options={taxes.filter((t) => t.active).map((t) => ({ value: t.id, label: t.name }))} {...form.bind('tax_id')} />
      <Select label="Billing period" options={PERIODS.map((p) => ({ value: p, label: p[0].toUpperCase() + p.slice(1) }))} {...form.bind('billing_period')} />
      <Input label="Minimum quantity" type="number" min="1" {...form.bind('min_quantity')} />
      <Input label="Available from" type="date" {...form.bind('start_date')} />
      <Input label="Available until" type="date" min={form.values.start_date} help="Optional" {...form.bind('end_date')} />
      <Field label="Lifecycle rules" className="full">
        <div className="grid grid-2" style={{ gap: 10 }}>
          <Checkbox label="Close automatically at expiry" checked={form.values.auto_close} onChange={form.set('auto_close')} />
          <Checkbox label="Can be closed early" checked={form.values.closable} onChange={form.set('closable')} />
          <Checkbox label="Can be paused" checked={form.values.pausable} onChange={form.set('pausable')} />
          <Checkbox label="Can be renewed" checked={form.values.renewable} onChange={form.set('renewable')} />
          <Checkbox label="Available for new subscriptions" checked={form.values.active} onChange={form.set('active')} />
        </div>
      </Field>
      <div className="full form-actions">
        <button type="button" className="btn" onClick={onDone}>Cancel</button>
        <button className="btn btn-primary" disabled={form.busy}>{form.busy ? 'Saving…' : 'Save plan'}</button>
      </div>
    </form>
  );
}

export default function Plans() {
  const { user } = useAuth();
  const admin = user.role === 'admin';
  const plans = useQuery('/catalog/plans?all=true', { topics: ['plans', 'subscriptions'] });
  const taxes = useQuery('/catalog/taxes', { topics: ['taxes'] });
  const [editing, setEditing] = useState(null);

  return (
    <>
      <PageHead title="Plans" subtitle="Pricing, billing frequency and what customers may do with each plan.">
        {admin && <button type="button" className="btn btn-primary" onClick={() => setEditing({})}>New plan</button>}
      </PageHead>
      <Card flush>
        <Loadable query={plans}>
          {(rows) => (rows.length ? (
            <div className="table-wrap"><table>
              <thead><tr><th>Name</th><th>Billing</th><th className="num">Price</th><th>Tax</th><th className="num">Min qty</th><th>Available</th><th>Rules</th><th className="num">Active subs</th><th>Status</th></tr></thead>
              <tbody>{rows.map((p) => (
                <tr key={p.id} className={admin ? 'clickable' : ''} onClick={() => admin && setEditing(p)}>
                  <td><strong>{p.name}</strong></td>
                  <td style={{ textTransform: 'capitalize' }}>{p.billing_period}</td>
                  <td className="num">{money(p.price)}</td>
                  <td>{p.tax_name ?? '—'}</td>
                  <td className="num">{p.min_quantity}</td>
                  <td>{date(p.start_date)} – {p.end_date ? date(p.end_date) : 'open'}</td>
                  <td className="row" style={{ gap: 4 }}>
                    {p.auto_close && <Badge tone="amber">auto-close</Badge>}
                    {p.pausable && <Badge tone="blue">pause</Badge>}
                    {p.renewable && <Badge tone="teal">renew</Badge>}
                    {p.closable && <Badge>close</Badge>}
                  </td>
                  <td className="num">{p.active_subscriptions}</td>
                  <td>{p.active ? <Badge tone="green">Active</Badge> : <Badge>Archived</Badge>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          ) : <Empty title="No plans yet" />)}
        </Loadable>
      </Card>
      {editing && (
        <Modal wide title={editing.id ? `Edit ${editing.name}` : 'New plan'} onClose={() => setEditing(null)}>
          <PlanForm plan={editing.id ? editing : null} taxes={taxes.data ?? []} onDone={() => setEditing(null)} />
        </Modal>
      )}
    </>
  );
}

import { useState } from 'react';
import { api } from '../api/client.js';
import { useAuth } from '../hooks/auth.jsx';
import { useQuery } from '../hooks/useQuery.js';
import { useToast } from '../hooks/toast.jsx';
import { Card, PageHead, Loadable, Modal, Input, Select, Field, Checkbox, Badge, Empty, FormError, useForm } from '../components/ui.jsx';
import { date, money, today } from '../lib.js';

function DiscountForm({ discount, products, onDone }) {
  const notify = useToast();
  const form = useForm({
    name: discount?.name ?? '', type: discount?.type ?? 'percentage', value: discount?.value ?? '',
    scope: discount?.scope ?? 'subscription', min_amount: discount?.min_amount ?? 0, min_quantity: discount?.min_quantity ?? 0,
    start_date: discount?.start_date ?? today(), end_date: discount?.end_date ?? '', usage_limit: discount?.usage_limit ?? '',
    active: discount?.active ?? true, product_ids: (discount?.product_ids ?? []).map(String),
  });
  const toggleProduct = (id) => {
    const ids = form.values.product_ids;
    form.set('product_ids')(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  };
  const onSubmit = form.submit(async (v) => {
    const body = {
      ...v, value: Number(v.value), min_amount: Number(v.min_amount || 0), min_quantity: Number(v.min_quantity || 0),
      usage_limit: v.usage_limit === '' ? null : Number(v.usage_limit), product_ids: v.scope === 'product' ? v.product_ids.map(Number) : [],
    };
    await (discount ? api.put(`/discounts/${discount.id}`, body) : api.post('/discounts', body));
    notify('Discount saved');
    onDone();
  });
  return (
    <form className="form-grid" onSubmit={onSubmit} noValidate>
      <FormError error={form.formError} />
      <Input label="Name" autoFocus {...form.bind('name')} />
      <Select label="Type" options={[{ value: 'percentage', label: 'Percentage' }, { value: 'fixed', label: 'Fixed amount' }]} {...form.bind('type')} />
      <Input label={form.values.type === 'percentage' ? 'Percent off' : 'Amount off'} type="number" step="0.01" min="0.01" {...form.bind('value')} />
      <Select label="Applies to" options={[{ value: 'subscription', label: 'Whole subscription' }, { value: 'product', label: 'Specific products' }]} {...form.bind('scope')} />
      <Input label="Minimum purchase" type="number" step="0.01" min="0" {...form.bind('min_amount')} />
      <Input label="Minimum quantity" type="number" min="0" {...form.bind('min_quantity')} />
      <Input label="Starts" type="date" {...form.bind('start_date')} />
      <Input label="Ends" type="date" min={form.values.start_date} help="Optional" {...form.bind('end_date')} />
      <Input label="Usage limit" type="number" min="1" help={`Leave empty for unlimited${discount ? ` · used ${discount.used_count} times` : ''}`} {...form.bind('usage_limit')} />
      <Field label="Status"><Checkbox label="Active" checked={form.values.active} onChange={form.set('active')} /></Field>
      {form.values.scope === 'product' && (
        <Field label="Products" className="full" error={form.errors.product_ids}>
          <div className="grid grid-2" style={{ gap: 8 }}>
            {products.map((p) => <Checkbox key={p.id} label={p.name} checked={form.values.product_ids.includes(String(p.id))} onChange={() => toggleProduct(String(p.id))} />)}
          </div>
        </Field>
      )}
      <div className="full form-actions">
        <button type="button" className="btn" onClick={onDone}>Cancel</button>
        <button className="btn btn-primary" disabled={form.busy}>{form.busy ? 'Saving…' : 'Save discount'}</button>
      </div>
    </form>
  );
}

export default function Discounts() {
  const { user } = useAuth();
  const admin = user.role === 'admin';
  const discounts = useQuery('/discounts', { topics: ['discounts', 'invoices'] });
  const products = useQuery('/catalog/products');
  const [editing, setEditing] = useState(null);

  return (
    <>
      <PageHead title="Discounts" subtitle="Applied automatically on the next invoice until they expire or run out.">
        {admin && <button type="button" className="btn btn-primary" onClick={() => setEditing({})}>New discount</button>}
      </PageHead>
      <Card flush>
        <Loadable query={discounts}>
          {(rows) => (rows.length ? (
            <div className="table-wrap"><table>
              <thead><tr><th>Name</th><th>Value</th><th>Applies to</th><th>Conditions</th><th>Valid</th><th className="num">Used</th><th>Status</th></tr></thead>
              <tbody>{rows.map((d) => (
                <tr key={d.id} className={admin ? 'clickable' : ''} onClick={() => admin && setEditing(d)}>
                  <td><strong>{d.name}</strong></td>
                  <td>{d.type === 'percentage' ? `${Number(d.value)}%` : money(d.value)}</td>
                  <td>{d.scope === 'product' ? `${d.product_ids.length} product(s)` : 'Subscription'}</td>
                  <td className="muted small">
                    {[Number(d.min_amount) && `min ${money(d.min_amount)}`, d.min_quantity && `min qty ${d.min_quantity}`].filter(Boolean).join(' · ') || 'none'}
                  </td>
                  <td>{date(d.start_date)} – {d.end_date ? date(d.end_date) : 'open'}</td>
                  <td className="num">{d.used_count}{d.usage_limit ? ` / ${d.usage_limit}` : ''}</td>
                  <td>{d.usable ? <Badge tone="green">Live</Badge> : <Badge tone={d.active ? 'amber' : ''}>{d.active ? 'Expired' : 'Inactive'}</Badge>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          ) : <Empty title="No discounts yet" />)}
        </Loadable>
      </Card>
      {editing && (
        <Modal wide title={editing.id ? `Edit ${editing.name}` : 'New discount'} onClose={() => setEditing(null)}>
          <DiscountForm discount={editing.id ? editing : null} products={products.data ?? []} onDone={() => setEditing(null)} />
        </Modal>
      )}
    </>
  );
}

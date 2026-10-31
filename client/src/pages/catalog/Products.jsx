import { useState } from 'react';
import { api } from '../../api/client.js';
import { useAuth } from '../../hooks/auth.jsx';
import { useQuery } from '../../hooks/useQuery.js';
import { useToast } from '../../hooks/toast.jsx';
import { Card, PageHead, Loadable, Modal, Input, Select, Field, Checkbox, Badge, Empty, FormError, useForm } from '../../components/ui.jsx';
import { money } from '../../lib.js';

function ProductForm({ product, taxes, onDone }) {
  const notify = useToast();
  const form = useForm({
    name: product?.name ?? '', type: product?.type ?? 'service',
    sales_price: product?.sales_price ?? '', cost_price: product?.cost_price ?? 0,
    tax_id: product?.tax_id ? String(product.tax_id) : '', notes: product?.notes ?? '',
    active: product?.active ?? true,
    variants: product?.variants ?? [],
  });
  const variants = form.values.variants;
  const setVariant = (i, patch) => form.set('variants')(variants.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));

  const onSubmit = form.submit(async (v) => {
    const body = {
      ...v,
      sales_price: Number(v.sales_price), cost_price: Number(v.cost_price || 0), tax_id: Number(v.tax_id) || null,
      variants: v.variants.map((x) => ({ ...x, extra_price: Number(x.extra_price || 0) })),
    };
    await (product ? api.put(`/catalog/products/${product.id}`, body) : api.post('/catalog/products', body));
    notify('Product saved');
    onDone();
  });

  return (
    <form className="form-grid" onSubmit={onSubmit} noValidate>
      <FormError error={form.formError} />
      <Input label="Name" autoFocus {...form.bind('name')} />
      <Select label="Type" options={[{ value: 'service', label: 'Service' }, { value: 'goods', label: 'Goods' }]} {...form.bind('type')} />
      <Input label="Sales price" type="number" step="0.01" min="0" {...form.bind('sales_price')} />
      <Input label="Cost price" type="number" step="0.01" min="0" {...form.bind('cost_price')} />
      <Select label="Tax" placeholder="No tax" options={taxes.filter((t) => t.active).map((t) => ({ value: t.id, label: t.name }))} {...form.bind('tax_id')} />
      <Field label="Status"><Checkbox label="Available for sale" checked={form.values.active} onChange={form.set('active')} /></Field>
      <Field label="Notes" className="full"><textarea className="input" value={form.values.notes} onChange={form.set('notes')} /></Field>
      <div className="full">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <h3>Variants</h3>
          <button type="button" className="btn btn-sm" onClick={() => form.set('variants')([...variants, { attribute: 'Brand', value: '', extra_price: 0 }])}>+ Add variant</button>
        </div>
        {variants.length ? (
          <table className="lines-table">
            <thead><tr><th>Attribute</th><th>Value</th><th>Extra price</th><th aria-label="Remove" /></tr></thead>
            <tbody>
              {variants.map((v, i) => (
                <tr key={v.id ?? `new-${i}`}>
                  <td><input className="input" value={v.attribute} onChange={(e) => setVariant(i, { attribute: e.target.value })} aria-label="Attribute" /></td>
                  <td><input className="input" value={v.value} onChange={(e) => setVariant(i, { value: e.target.value })} aria-label="Value" placeholder="e.g. Odoo" /></td>
                  <td><input className="input" type="number" step="0.01" min="0" value={v.extra_price} onChange={(e) => setVariant(i, { extra_price: e.target.value })} aria-label="Extra price" /></td>
                  <td><button type="button" className="btn btn-ghost btn-sm btn-danger" onClick={() => form.set('variants')(variants.filter((_, idx) => idx !== i))} aria-label="Remove variant">✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="muted small" style={{ margin: 0 }}>No variants. Add one to offer e.g. a brand that changes the price.</p>}
        {form.errors.variants && <small className="err" style={{ color: 'var(--danger)' }}>{form.errors.variants}</small>}
      </div>
      <div className="full form-actions">
        <button type="button" className="btn" onClick={onDone}>Cancel</button>
        <button className="btn btn-primary" disabled={form.busy}>{form.busy ? 'Saving…' : 'Save product'}</button>
      </div>
    </form>
  );
}

export default function Products() {
  const { user } = useAuth();
  const admin = user.role === 'admin';
  const products = useQuery('/catalog/products?all=true', { topics: ['products'] });
  const taxes = useQuery('/catalog/taxes', { topics: ['taxes'] });
  const [editing, setEditing] = useState(null);

  return (
    <>
      <PageHead title="Products" subtitle="What Brightloop sells, with variants that adjust the price.">
        {admin && <button type="button" className="btn btn-primary" onClick={() => setEditing({})}>New product</button>}
      </PageHead>
      <Card flush>
        <Loadable query={products}>
          {(rows) => (rows.length ? (
            <div className="table-wrap"><table>
              <thead><tr><th>Name</th><th>Type</th><th>Variants</th><th>Tax</th><th className="num">Cost</th><th className="num">Sales price</th><th>Status</th></tr></thead>
              <tbody>{rows.map((p) => (
                <tr key={p.id} className={admin ? 'clickable' : ''} onClick={() => admin && setEditing(p)}>
                  <td><strong>{p.name}</strong>{p.notes && <div className="muted small">{p.notes}</div>}</td>
                  <td style={{ textTransform: 'capitalize' }}>{p.type}</td>
                  <td>{p.variants.length ? p.variants.map((v) => `${v.value}${Number(v.extra_price) ? ` +${money(v.extra_price)}` : ''}`).join(', ') : '—'}</td>
                  <td>{p.tax_name ?? '—'}</td>
                  <td className="num">{money(p.cost_price)}</td>
                  <td className="num">{money(p.sales_price)}</td>
                  <td>{p.active ? <Badge tone="green">Active</Badge> : <Badge>Archived</Badge>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          ) : <Empty title="No products yet" />)}
        </Loadable>
      </Card>
      {editing && (
        <Modal wide title={editing.id ? `Edit ${editing.name}` : 'New product'} onClose={() => setEditing(null)}>
          <ProductForm product={editing.id ? editing : null} taxes={taxes.data ?? []} onDone={() => setEditing(null)} />
        </Modal>
      )}
    </>
  );
}

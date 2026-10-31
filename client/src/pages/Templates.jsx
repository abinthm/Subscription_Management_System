import { useState } from 'react';
import { api } from '../api/client.js';
import { useQuery } from '../hooks/useQuery.js';
import { useToast } from '../hooks/toast.jsx';
import { Card, PageHead, Loadable, Modal, Input, Select, Field, Empty, FormError, useForm } from '../components/ui.jsx';
import LinesEditor, { emptyLine, toLinePayload } from '../components/LinesEditor.jsx';

function TemplateForm({ template, plans, products, onDone }) {
  const notify = useToast();
  const form = useForm({
    name: template?.name ?? '', plan_id: template?.plan_id ? String(template.plan_id) : '',
    validity_days: template?.validity_days ?? 30, notes: template?.notes ?? '',
    lines: template?.lines?.map((l) => ({ product_id: String(l.product_id), variant_id: l.variant_id ? String(l.variant_id) : '', quantity: l.quantity })) ?? [emptyLine()],
  });
  const plan = plans.find((p) => String(p.id) === form.values.plan_id);
  const onSubmit = form.submit(async (v) => {
    const body = { ...v, plan_id: Number(v.plan_id) || null, validity_days: Number(v.validity_days), lines: toLinePayload(v.lines) };
    await (template ? api.put(`/templates/${template.id}`, body) : api.post('/templates', body));
    notify('Template saved');
    onDone();
  });
  const remove = async () => {
    if (!window.confirm(`Delete template ${template.name}?`)) return;
    try {
      await api.del(`/templates/${template.id}`);
      notify('Template deleted');
      onDone();
    } catch (err) {
      notify(err.message, 'error');
    }
  };
  return (
    <form className="form-grid" onSubmit={onSubmit} noValidate>
      <FormError error={form.formError} />
      <Input label="Template name" autoFocus {...form.bind('name')} />
      <Select label="Plan" placeholder="Choose a plan" options={plans.map((p) => ({ value: p.id, label: `${p.name} (${p.billing_period})` }))} {...form.bind('plan_id')} />
      <Input label="Quotation valid for (days)" type="number" min="1" max="365" {...form.bind('validity_days')} />
      <Input label="Notes" {...form.bind('notes')} />
      <Field label="Product lines" className="full">
        <LinesEditor lines={form.values.lines} products={products} onChange={form.set('lines')} minQuantity={plan?.min_quantity ?? 1} error={form.errors.lines} />
      </Field>
      <div className="full form-actions">
        {template && <button type="button" className="btn btn-danger" onClick={remove} style={{ marginRight: 'auto' }}>Delete</button>}
        <button type="button" className="btn" onClick={onDone}>Cancel</button>
        <button className="btn btn-primary" disabled={form.busy}>{form.busy ? 'Saving…' : 'Save template'}</button>
      </div>
    </form>
  );
}

export default function Templates() {
  const templates = useQuery('/templates', { topics: ['templates'] });
  const plans = useQuery('/catalog/plans');
  const products = useQuery('/catalog/products');
  const [editing, setEditing] = useState(null);

  return (
    <>
      <PageHead title="Quotation templates" subtitle="Reusable offers with the right plan and product lines.">
        <button type="button" className="btn btn-primary" onClick={() => setEditing({})}>New template</button>
      </PageHead>
      <Card flush>
        <Loadable query={templates}>
          {(rows) => (rows.length ? (
            <div className="table-wrap"><table>
              <thead><tr><th>Name</th><th>Plan</th><th>Lines</th><th className="num">Valid for</th></tr></thead>
              <tbody>{rows.map((t) => (
                <tr key={t.id} className="clickable" onClick={() => setEditing(t)}>
                  <td><strong>{t.name}</strong>{t.notes && <div className="muted small">{t.notes}</div>}</td>
                  <td>{t.plan_name}</td>
                  <td>{t.lines.map((l) => `${l.quantity}× ${l.product_name}`).join(', ')}</td>
                  <td className="num">{t.validity_days} days</td>
                </tr>
              ))}</tbody>
            </table></div>
          ) : <Empty title="No templates yet" />)}
        </Loadable>
      </Card>
      {editing && plans.data && products.data && (
        <Modal wide title={editing.id ? `Edit ${editing.name}` : 'New template'} onClose={() => setEditing(null)}>
          <TemplateForm template={editing.id ? editing : null} plans={plans.data} products={products.data} onDone={() => setEditing(null)} />
        </Modal>
      )}
    </>
  );
}

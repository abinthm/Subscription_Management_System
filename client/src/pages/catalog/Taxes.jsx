import { useState } from 'react';
import { api } from '../../api/client.js';
import { useAuth } from '../../hooks/auth.jsx';
import { useQuery } from '../../hooks/useQuery.js';
import { useToast } from '../../hooks/toast.jsx';
import { Card, PageHead, Loadable, Modal, Input, Field, Checkbox, Badge, Empty, FormError, useForm } from '../../components/ui.jsx';

function TaxForm({ tax, onDone }) {
  const notify = useToast();
  const form = useForm({ name: tax?.name ?? '', rate: tax?.rate ?? '', active: tax?.active ?? true });
  const onSubmit = form.submit(async (v) => {
    const body = { ...v, rate: Number(v.rate) };
    await (tax ? api.put(`/catalog/taxes/${tax.id}`, body) : api.post('/catalog/taxes', body));
    notify('Tax saved');
    onDone();
  });
  return (
    <form className="form-grid" onSubmit={onSubmit} noValidate>
      <FormError error={form.formError} />
      <Input label="Name" autoFocus placeholder="GST 18%" {...form.bind('name')} />
      <Input label="Rate (%)" type="number" step="0.01" min="0" max="100" {...form.bind('rate')} />
      <Field label="Status" className="full"><Checkbox label="Active" checked={form.values.active} onChange={form.set('active')} /></Field>
      <div className="full form-actions">
        <button type="button" className="btn" onClick={onDone}>Cancel</button>
        <button className="btn btn-primary" disabled={form.busy}>Save tax</button>
      </div>
    </form>
  );
}

export default function Taxes() {
  const { user } = useAuth();
  const admin = user.role === 'admin';
  const taxes = useQuery('/catalog/taxes', { topics: ['taxes'] });
  const [editing, setEditing] = useState(null);
  return (
    <>
      <PageHead title="Taxes" subtitle="Rates applied automatically to invoice lines through each product.">
        {admin && <button type="button" className="btn btn-primary" onClick={() => setEditing({})}>New tax</button>}
      </PageHead>
      <Card flush>
        <Loadable query={taxes}>
          {(rows) => (rows.length ? (
            <div className="table-wrap"><table>
              <thead><tr><th>Name</th><th className="num">Rate</th><th>Status</th></tr></thead>
              <tbody>{rows.map((t) => (
                <tr key={t.id} className={admin ? 'clickable' : ''} onClick={() => admin && setEditing(t)}>
                  <td><strong>{t.name}</strong></td><td className="num">{Number(t.rate)}%</td>
                  <td>{t.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          ) : <Empty title="No taxes yet" />)}
        </Loadable>
      </Card>
      {editing && <Modal title={editing.id ? `Edit ${editing.name}` : 'New tax'} onClose={() => setEditing(null)}><TaxForm tax={editing.id ? editing : null} onDone={() => setEditing(null)} /></Modal>}
    </>
  );
}

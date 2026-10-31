import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client.js';
import { useQuery } from '../../hooks/useQuery.js';
import { useAuth } from '../../hooks/auth.jsx';
import { ActiveToggle } from '../../components/UserForm.jsx';
import { useToast } from '../../hooks/toast.jsx';
import { Card, PageHead, Loadable, StatusBadge, Badge, Empty, Input, FormError, useForm } from '../../components/ui.jsx';
import { date, money } from '../../lib.js';

function ProfileForm({ customer, onSaved }) {
  const notify = useToast();
  const form = useForm({ name: customer.name, phone: customer.phone ?? '', address: customer.address ?? '' });
  return (
    <form className="form-grid" style={{ gridTemplateColumns: '1fr' }} onSubmit={form.submit(async (v) => { onSaved(await api.put(`/users/${customer.id}`, v)); notify('Customer saved'); })} noValidate>
      <FormError error={form.formError} />
      <Input label="Name" {...form.bind('name')} />
      <Input label="Phone" {...form.bind('phone')} />
      <Input label="Address" {...form.bind('address')} />
      <div className="form-actions" style={{ marginTop: 0 }}><button className="btn btn-primary" disabled={form.busy}>Save</button></div>
    </form>
  );
}

export default function CustomerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const customer = useQuery(`/users/${id}`, { topics: ['users'] });
  const subs = useQuery(`/subscriptions?customer_id=${id}&limit=50`, { topics: ['subscriptions'] });
  const invoices = useQuery(`/invoices?customer_id=${id}&limit=10`, { topics: ['invoices'] });

  return (
    <Loadable query={customer}>
      {(c) => (
        <>
          <PageHead crumb={<Link to="/customers">Customers</Link>} title={<span className="row">{c.name} {!c.active && <Badge>Inactive</Badge>}</span>} subtitle={`${c.email} · customer since ${date(c.created_at)}`}>
            {user.role === 'admin' && <ActiveToggle user={c} onChange={customer.setData} />}
            <Link className="btn btn-primary" to="/subscriptions/new">New subscription</Link>
          </PageHead>
          <div className="split">
            <div className="stack">
              <Card title="Subscriptions" flush>
                <Loadable query={subs}>
                  {(res) => (res.data.length ? (
                    <div className="table-wrap"><table>
                      <thead><tr><th>Number</th><th>Plan</th><th>Status</th><th className="num">Recurring</th></tr></thead>
                      <tbody>{res.data.map((s) => (
                        <tr key={s.id} className="clickable" onClick={() => navigate(`/subscriptions/${s.id}`)}>
                          <td><Link to={`/subscriptions/${s.id}`}>{s.number}</Link></td><td>{s.plan_name}</td>
                          <td><StatusBadge status={s.status} /></td><td className="num">{money(s.recurring_amount)}</td>
                        </tr>
                      ))}</tbody>
                    </table></div>
                  ) : <Empty title="No subscriptions yet" />)}
                </Loadable>
              </Card>
              <Card title="Recent invoices" flush actions={<Link className="btn btn-sm" to={`/invoices?customer_id=${id}`}>View all</Link>}>
                <Loadable query={invoices}>
                  {(res) => (res.data.length ? (
                    <div className="table-wrap"><table>
                      <thead><tr><th>Number</th><th>Due</th><th>Status</th><th className="num">Balance</th></tr></thead>
                      <tbody>{res.data.map((i) => (
                        <tr key={i.id} className="clickable" onClick={() => navigate(`/invoices/${i.id}`)}>
                          <td><Link to={`/invoices/${i.id}`}>{i.number}</Link></td><td>{date(i.due_date)}</td>
                          <td>{i.is_overdue ? <Badge tone="red">Overdue</Badge> : <StatusBadge status={i.status} />}</td>
                          <td className="num">{money(i.balance)}</td>
                        </tr>
                      ))}</tbody>
                    </table></div>
                  ) : <Empty title="No invoices yet" />)}
                </Loadable>
              </Card>
            </div>
            <Card title="Contact details"><ProfileForm key={c.id} customer={c} onSaved={customer.setData} /></Card>
          </div>
        </>
      )}
    </Loadable>
  );
}

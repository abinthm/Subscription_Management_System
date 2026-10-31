import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { qs } from '../../api/client.js';
import { useFilters, usePaging } from '../../hooks/useFilters.js';
import { useQuery } from '../../hooks/useQuery.js';
import { Card, PageHead, Loadable, Pager, SearchBox, Modal, Empty } from '../../components/ui.jsx';
import UserForm from '../../components/UserForm.jsx';
import { date } from '../../lib.js';

export default function CustomerList() {
  const navigate = useNavigate();
  const [filters, setFilter] = useFilters();
  const paging = usePaging(filters, setFilter);
  const [adding, setAdding] = useState(false);
  const list = useQuery(`/users${qs({ ...filters, role: 'customer' })}`, { topics: ['users', 'subscriptions'] });

  return (
    <>
      <PageHead title="Customers" subtitle="Everyone with a portal account.">
        <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>Add customer</button>
      </PageHead>
      <Card flush>
        <div className="toolbar"><SearchBox value={filters.q} onChange={(v) => setFilter('q', v)} placeholder="Search by name or email" /></div>
        <Loadable query={list}>
          {(res) => (res.data.length ? (
            <>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th className="num">Active subscriptions</th><th>Joined</th></tr></thead>
                  <tbody>
                    {res.data.map((c) => (
                      <tr key={c.id} className="clickable" onClick={() => navigate(`/customers/${c.id}`)}>
                        <td><Link to={`/customers/${c.id}`}>{c.name}</Link></td>
                        <td>{c.email}</td>
                        <td>{c.phone ?? '—'}</td>
                        <td className="num">{c.active_subscriptions}</td>
                        <td>{date(c.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager res={res} paging={paging} />
            </>
          ) : <Empty title="No customers found" />)}
        </Loadable>
      </Card>
      {adding && (
        <Modal title="Add customer" onClose={() => setAdding(false)}>
          <UserForm roles={['customer']} onDone={(u) => { setAdding(false); if (u) navigate(`/customers/${u.id}`); }} />
        </Modal>
      )}
    </>
  );
}

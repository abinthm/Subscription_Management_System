import { useState } from 'react';
import { qs } from '../api/client.js';
import { useFilters } from '../hooks/useFilters.js';
import { useQuery } from '../hooks/useQuery.js';
import { Card, PageHead, Loadable, Pager, SearchBox, Modal, Badge } from '../components/ui.jsx';
import UserForm from '../components/UserForm.jsx';
import { date } from '../lib.js';

export default function Team() {
  const [filters, setFilter] = useFilters({ role: 'staff' });
  const [adding, setAdding] = useState(false);
  const list = useQuery(`/users${qs(filters)}`, { topics: ['users'] });

  return (
    <>
      <PageHead title="Team" subtitle="Admins control everything; staff handle day-to-day work.">
        <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>Add team member</button>
      </PageHead>
      <Card flush>
        <div className="toolbar">
          <SearchBox value={filters.q} onChange={(v) => setFilter('q', v)} placeholder="Search by name or email" />
          <select className="input" value={filters.role} onChange={(e) => setFilter('role', e.target.value)} aria-label="Role">
            <option value="staff">Staff</option>
            <option value="admin">Admins</option>
          </select>
        </div>
        <Loadable query={list}>
          {(res) => (
            <>
              <div className="table-wrap"><table>
                <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Added</th></tr></thead>
                <tbody>{res.data.map((u) => (
                  <tr key={u.id}><td>{u.name}</td><td>{u.email}</td><td><Badge tone={u.role === 'admin' ? 'plum' : 'teal'}>{u.role}</Badge></td><td>{date(u.created_at)}</td></tr>
                ))}</tbody>
              </table></div>
              <Pager {...res} onPage={(p) => setFilter('page', p)} />
            </>
          )}
        </Loadable>
      </Card>
      {adding && <Modal title="Add team member" onClose={() => setAdding(false)}><UserForm roles={['staff', 'admin']} onDone={() => setAdding(false)} /></Modal>}
    </>
  );
}

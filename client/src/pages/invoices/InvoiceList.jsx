import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, qs } from '../../api/client.js';
import { useAuth, isTeam } from '../../hooks/auth.jsx';
import { useFilters, usePaging } from '../../hooks/useFilters.js';
import { useQuery } from '../../hooks/useQuery.js';
import { useToast } from '../../hooks/toast.jsx';
import { Card, PageHead, Loadable, Pager, SearchBox, StatusBadge, Badge, Empty } from '../../components/ui.jsx';
import { date, money } from '../../lib.js';

export default function InvoiceList() {
  const { user } = useAuth();
  const team = isTeam(user);
  const navigate = useNavigate();
  const notify = useToast();
  const [filters, setFilter] = useFilters();
  const paging = usePaging(filters, setFilter);
  const list = useQuery(`/invoices${qs(filters)}`, { topics: ['invoices'] });
  const [running, setRunning] = useState(false);

  const runBilling = async () => {
    setRunning(true);
    try {
      const r = await api.post('/invoices/billing-run');
      notify(r.created ? `${r.created} invoices created` : 'Nothing due for billing today');
      if (r.failed.length) notify(`${r.failed.length} subscriptions could not be billed`, 'error');
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <PageHead title="Invoices" subtitle={team ? 'Generated from subscriptions on each billing date.' : 'Your invoices and what is still due.'}>
        <a className="btn" href={`/api/invoices${qs({ ...filters, cursor: '', format: 'csv' })}`} download>Export CSV</a>
        {team && <button type="button" className="btn btn-primary" onClick={runBilling} disabled={running}>{running ? 'Billing…' : 'Run billing now'}</button>}
      </PageHead>
      <Card flush>
        <div className="toolbar">
          <SearchBox value={filters.q} onChange={(v) => setFilter('q', v)} placeholder="Search by invoice or customer" />
          <select className="input" value={filters.status ?? ''} onChange={(e) => setFilter('status', e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {['draft', 'confirmed', 'paid', 'cancelled'].map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
          </select>
          <label className="check"><input type="checkbox" checked={filters.overdue === 'true'} onChange={(e) => setFilter('overdue', e.target.checked ? 'true' : '')} />Overdue only</label>
          <input className="input" type="date" value={filters.from ?? ''} onChange={(e) => setFilter('from', e.target.value)} aria-label="Issued from" title="Issued from" />
          <input className="input" type="date" value={filters.to ?? ''} onChange={(e) => setFilter('to', e.target.value)} aria-label="Issued to" title="Issued to" />
        </div>
        <Loadable query={list}>
          {(res) => (res.data.length ? (
            <>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Number</th>{team && <th>Customer</th>}<th>Subscription</th><th>Issued</th><th>Due</th><th>Status</th><th className="num">Total</th><th className="num">Balance</th></tr></thead>
                  <tbody>
                    {res.data.map((i) => (
                      <tr key={i.id} className="clickable" onClick={() => navigate(`/invoices/${i.id}`)}>
                        <td><Link to={`/invoices/${i.id}`}>{i.number}</Link></td>
                        {team && <td>{i.customer_name}</td>}
                        <td>{i.subscription_number}</td>
                        <td>{date(i.issue_date)}</td>
                        <td>{date(i.due_date)}</td>
                        <td>{i.is_overdue ? <Badge tone="red">Overdue</Badge> : <StatusBadge status={i.status} />}</td>
                        <td className="num">{money(i.total)}</td>
                        <td className="num">{i.status === 'cancelled' ? '—' : money(i.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager res={res} paging={paging} />
            </>
          ) : <Empty title="No invoices found">Adjust the filters, or run billing to generate due invoices.</Empty>)}
        </Loadable>
      </Card>
    </>
  );
}

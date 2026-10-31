import { Link } from 'react-router-dom';
import { qs } from '../api/client.js';
import { useAuth, isTeam } from '../hooks/auth.jsx';
import { useFilters } from '../hooks/useFilters.js';
import { useQuery } from '../hooks/useQuery.js';
import { Card, PageHead, Loadable, Pager, SearchBox, Empty } from '../components/ui.jsx';
import { date, label, money } from '../lib.js';

export default function Payments() {
  const { user } = useAuth();
  const team = isTeam(user);
  const [filters, setFilter] = useFilters();
  const list = useQuery(`/payments${qs(filters)}`, { topics: ['payments'] });

  return (
    <>
      <PageHead title="Payments" subtitle={team ? 'Every payment received, matched to its invoice.' : 'Payments received on your invoices.'} />
      <Card flush>
        <div className="toolbar">
          <SearchBox value={filters.q} onChange={(v) => setFilter('q', v)} placeholder="Search by invoice or customer" />
          <select className="input" value={filters.method ?? ''} onChange={(e) => setFilter('method', e.target.value)} aria-label="Method">
            <option value="">All methods</option>
            {['bank_transfer', 'card', 'upi', 'cash', 'cheque'].map((m) => <option key={m} value={m}>{label(m)}</option>)}
          </select>
          <input className="input" type="date" value={filters.from ?? ''} onChange={(e) => setFilter('from', e.target.value)} aria-label="Paid from" title="Paid from" />
          <input className="input" type="date" value={filters.to ?? ''} onChange={(e) => setFilter('to', e.target.value)} aria-label="Paid to" title="Paid to" />
        </div>
        <Loadable query={list}>
          {(res) => (res.data.length ? (
            <>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Date</th><th>Invoice</th>{team && <th>Customer</th>}<th>Method</th><th>Note</th><th className="num">Amount</th></tr></thead>
                  <tbody>
                    {res.data.map((p) => (
                      <tr key={p.id}>
                        <td>{date(p.paid_on)}</td>
                        <td><Link to={`/invoices/${p.invoice_id}`}>{p.invoice_number}</Link></td>
                        {team && <td>{p.customer_name}</td>}
                        <td style={{ textTransform: 'capitalize' }}>{label(p.method)}</td>
                        <td className="muted">{p.note ?? '—'}</td>
                        <td className="num">{money(p.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager {...res} onPage={(p) => setFilter('page', p)} />
            </>
          ) : <Empty title="No payments found" />)}
        </Loadable>
      </Card>
    </>
  );
}

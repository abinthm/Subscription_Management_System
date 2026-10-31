import { Link, useNavigate } from 'react-router-dom';
import { qs } from '../../api/client.js';
import { useAuth, isTeam } from '../../hooks/auth.jsx';
import { useFilters } from '../../hooks/useFilters.js';
import { useQuery } from '../../hooks/useQuery.js';
import { Card, PageHead, Loadable, Pager, SearchBox, StatusBadge, Empty } from '../../components/ui.jsx';
import { date, label, money } from '../../lib.js';

const STATUSES = ['draft', 'quotation', 'confirmed', 'active', 'paused', 'closed'];

export default function SubscriptionList() {
  const { user } = useAuth();
  const team = isTeam(user);
  const navigate = useNavigate();
  const [filters, setFilter] = useFilters();
  const plans = useQuery(team ? '/catalog/plans' : null, { enabled: team });
  const list = useQuery(`/subscriptions${qs(filters)}`, { topics: ['subscriptions'] });

  return (
    <>
      <PageHead
        title={team ? 'Subscriptions' : 'My subscriptions'}
        subtitle={team ? 'Every subscription from draft quote to closed contract.' : 'Plans you are subscribed to and where each one stands.'}
      >
        <a className="btn" href={`/api/subscriptions${qs({ ...filters, page: '', format: 'csv' })}`} download>Export CSV</a>
        <Link className="btn btn-primary" to={team ? '/subscriptions/new' : '/subscribe'}>{team ? 'New subscription' : 'Start a subscription'}</Link>
      </PageHead>
      <Card flush>
        <div className="toolbar">
          <SearchBox value={filters.q} onChange={(v) => setFilter('q', v)} placeholder={team ? "Search by number or customer" : "Search by number"} />
          <select className="input" value={filters.status ?? ''} onChange={(e) => setFilter('status', e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
          </select>
          {team && (
            <select className="input" value={filters.plan_id ?? ''} onChange={(e) => setFilter('plan_id', e.target.value)} aria-label="Plan">
              <option value="">All plans</option>
              {plans.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          )}
        </div>
        <Loadable query={list}>
          {(res) => (res.data.length ? (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Number</th>{team && <th>Customer</th>}<th>Plan</th><th>Status</th>
                      <th>Start</th><th>Next invoice</th><th className="num">Recurring</th>
                    </tr>
                  </thead>
                  <tbody>
                    {res.data.map((s) => (
                      <tr key={s.id} className="clickable" onClick={() => navigate(`/subscriptions/${s.id}`)}>
                        <td><Link to={`/subscriptions/${s.id}`}>{s.number}</Link></td>
                        {team && <td>{s.customer_name}</td>}
                        <td>{s.plan_name} <span className="muted small">· {s.billing_period}</span></td>
                        <td><StatusBadge status={s.status} /></td>
                        <td>{date(s.start_date)}</td>
                        <td>{s.status === 'active' ? date(s.next_invoice_date) : '—'}</td>
                        <td className="num">{money(s.recurring_amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager {...res} onPage={(p) => setFilter('page', p)} />
            </>
          ) : <Empty title="No subscriptions found">Try a different search or filter.</Empty>)}
        </Loadable>
      </Card>
    </>
  );
}

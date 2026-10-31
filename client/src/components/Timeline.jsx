import { Card, Empty } from './ui.jsx';

const when = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

const TONE = {
  payment: 'good', refund: 'warn', invoice_cancel: 'warn', close: 'muted', system: 'muted',
  pause: 'warn', confirm: 'brand', activate: 'brand', created: 'brand', quotation_emailed: 'brand',
};

export default function Timeline({ items, className = '' }) {
  return (
    <Card title="Activity" className={className}>
      {items.length ? (
        <ol className="timeline">
          {items.map((a) => (
            <li key={a.id} className={`tl-${TONE[a.action] ?? 'default'}`}>
              <div className="tl-message">{a.message}</div>
              <div className="tl-meta">
                {a.actor ? `${a.actor}${a.actor_role === 'customer' ? ' (customer)' : ''}` : 'System'} · {when.format(new Date(a.created_at))}
              </div>
            </li>
          ))}
        </ol>
      ) : <Empty title="No activity yet" />}
    </Card>
  );
}

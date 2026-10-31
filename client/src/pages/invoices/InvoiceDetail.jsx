import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, newIdempotencyKey } from '../../api/client.js';
import { useAuth, isTeam } from '../../hooks/auth.jsx';
import { useQuery } from '../../hooks/useQuery.js';
import { useToast } from '../../hooks/toast.jsx';
import { Card, PageHead, Loadable, StatusBadge, Badge, Modal, Input, Select, FormError, useForm } from '../../components/ui.jsx';
import { date, label, money, today } from '../../lib.js';
import Timeline from '../../components/Timeline.jsx';

const METHODS = ['bank_transfer', 'card', 'upi', 'cash', 'cheque'];

function PaymentForm({ invoice, onDone }) {
  const notify = useToast();
  const form = useForm({ method: 'bank_transfer', amount: String(invoice.balance), paid_on: today(), note: '' });
  const [idempotencyKey] = useState(newIdempotencyKey);
  const onSubmit = form.submit(async (v) => {
    await api.post('/payments', { ...v, invoice_id: invoice.id, amount: Number(v.amount) }, { idempotencyKey });
    notify('Payment recorded');
    onDone();
  });
  return (
    <form className="form-grid" onSubmit={onSubmit} noValidate>
      <FormError error={form.formError} />
      <Select label="Method" options={METHODS.map((m) => ({ value: m, label: label(m) }))} {...form.bind('method')} />
      <Input label="Amount" type="number" step="0.01" min="0.01" max={invoice.balance} help={`Balance ${money(invoice.balance)}`} {...form.bind('amount')} />
      <Input label="Payment date" type="date" max={today()} {...form.bind('paid_on')} />
      <Input label="Note" placeholder="Reference, cheque no…" {...form.bind('note')} />
      <div className="full form-actions">
        <button type="button" className="btn" onClick={onDone}>Cancel</button>
        <button className="btn btn-primary" disabled={form.busy}>{form.busy ? 'Saving…' : 'Record payment'}</button>
      </div>
    </form>
  );
}

function loadCheckout() {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = resolve;
    script.onerror = () => {
      script.remove();
      reject(new Error('Could not load the payment window. Check your connection and try again.'));
    };
    document.body.append(script);
  });
}

export default function InvoiceDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const team = isTeam(user);
  const admin = user.role === 'admin';
  const notify = useToast();
  const invoice = useQuery(`/invoices/${id}`, { topics: ['invoices', 'payments'] });
  const online = useQuery('/payments/online/status', { enabled: !team });
  const [paying, setPaying] = useState(false);
  const [busy, setBusy] = useState('');

  const act = async (action, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(action);
    try {
      const updated = await api.post(`/invoices/${id}/${action}`);
      invoice.setData(updated);
      notify(action === 'send' ? `Invoice emailed to ${updated.customer_email}` : `Invoice ${action === 'cancel' ? 'cancelled' : 'confirmed'}`);
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const refund = async (payment) => {
    const reason = window.prompt(`Refund ${money(payment.amount)}? Enter a reason:`);
    if (reason === null) return;
    setBusy('refund');
    try {
      await api.post(`/payments/${payment.id}/refund`, { reason }, { idempotencyKey: `refund-${payment.id}` });
      notify('Payment refunded');
      invoice.reload({ silent: true });
    } catch (err) {
      notify(err.details?.reason ?? err.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const payOnline = async (inv) => {
    setBusy('pay');
    try {
      const [order] = await Promise.all([api.post('/payments/online/order', { invoice_id: inv.id }), loadCheckout()]);
      new window.Razorpay({
        key: order.key_id,
        order_id: order.order_id,
        amount: order.amount,
        currency: order.currency,
        name: 'Brightloop Software',
        description: `Invoice ${inv.number}`,
        prefill: { name: inv.customer_name, email: inv.customer_email, contact: inv.customer_phone ?? '' },
        theme: { color: '#714b67' },
        modal: { ondismiss: () => setBusy('') },
        handler: async (r) => {
          try {
            await api.post('/payments/online/verify', { order_id: r.razorpay_order_id, payment_id: r.razorpay_payment_id, signature: r.razorpay_signature });
            notify('Payment received. Thank you!');
            invoice.reload({ silent: true });
          } catch (err) {
            notify(err.message, 'error');
          } finally {
            setBusy('');
          }
        },
      }).open();
    } catch (err) {
      notify(err.message, 'error');
      setBusy('');
    }
  };

  return (
    <Loadable query={invoice}>
      {(inv) => (
        <>
          <PageHead
            crumb={<Link to="/invoices">Invoices</Link>}
            title={<span className="row">{inv.number} {inv.is_overdue ? <Badge tone="red">Overdue</Badge> : <StatusBadge status={inv.status} />}</span>}
            subtitle={`${inv.customer_name} · ${inv.subscription_number}`}
          >
            <div className="row no-print">
              {team && inv.status === 'draft' && <button type="button" className="btn btn-primary" disabled={Boolean(busy)} onClick={() => act('confirm')}>Confirm</button>}
              {team && inv.status === 'confirmed' && <button type="button" className="btn btn-accent" onClick={() => setPaying(true)}>Record payment</button>}
              {!team && online.data?.enabled && inv.status === 'confirmed' && Number(inv.balance) > 0 && (
                <button type="button" className="btn btn-accent" disabled={Boolean(busy)} onClick={() => payOnline(inv)}>{busy === 'pay' ? 'Opening…' : `Pay ${money(inv.balance)}`}</button>
              )}
              {team && ['confirmed', 'paid'].includes(inv.status) && <button type="button" className="btn" disabled={Boolean(busy)} onClick={() => act('send')}>{busy === 'send' ? 'Sending…' : inv.sent_at ? 'Send again' : 'Send'}</button>}
              <button type="button" className="btn" onClick={() => window.print()}>Print</button>
              {team && ['draft', 'confirmed'].includes(inv.status) && Number(inv.amount_paid) === 0 && (
                <button type="button" className="btn btn-danger" disabled={Boolean(busy)} onClick={() => act('cancel', `Cancel ${inv.number}?`)}>Cancel</button>
              )}
            </div>
          </PageHead>

          <div className="stack">
            <Card flush>
              <div className="invoice-doc">
                <div className="doc-head">
                  <div>
                    <div className="logo" style={{ padding: 0 }}><span className="logo-mark" />Brightloop Software</div>
                    <p className="muted small" style={{ margin: '8px 0 0' }}>billing@brightloop.io</p>
                  </div>
                  <div className="right">
                    <h2>Invoice {inv.number}</h2>
                    <div className="muted small">Issued {date(inv.issue_date)} · Due {date(inv.due_date)}</div>
                    <div className="muted small">Period {date(inv.period_start)} – {date(inv.period_end)}</div>
                  </div>
                </div>
                <div style={{ marginBottom: 24 }}>
                  <div className="muted small">Bill to</div>
                  <strong>{inv.customer_name}</strong>
                  <div className="muted small">{inv.customer_email}{inv.customer_phone && ` · ${inv.customer_phone}`}</div>
                  {inv.customer_address && <div className="muted small">{inv.customer_address}</div>}
                </div>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Description</th><th className="num">Qty</th><th className="num">Unit price</th><th className="num">Discount</th><th className="num">Tax</th><th className="num">Amount</th></tr></thead>
                    <tbody>
                      {inv.lines.map((l) => (
                        <tr key={l.id}>
                          <td>{l.description}</td>
                          <td className="num">{l.quantity}</td>
                          <td className="num">{money(l.unit_price)}</td>
                          <td className="num">{Number(l.discount_amount) ? `−${money(l.discount_amount)}` : '—'}</td>
                          <td className="num">{money(l.tax_amount)} <span className="muted small">({Number(l.tax_rate)}%)</span></td>
                          <td className="num">{money(l.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="totals" style={{ marginTop: 20 }}>
                  <div><span className="muted">Subtotal</span><span className="mono">{money(inv.subtotal)}</span></div>
                  {Number(inv.discount_total) > 0 && <div><span className="muted">Discount{inv.discount_name && ` (${inv.discount_name})`}</span><span className="mono">−{money(inv.discount_total)}</span></div>}
                  <div><span className="muted">Tax</span><span className="mono">{money(inv.tax_total)}</span></div>
                  <div className="grand"><span>Total</span><span className="mono">{money(inv.total)}</span></div>
                  <div><span className="muted">Paid</span><span className="mono">{money(inv.amount_paid)}</span></div>
                  <div><strong>Balance due</strong><strong className="mono">{money(inv.status === 'cancelled' ? 0 : inv.balance)}</strong></div>
                </div>
              </div>
            </Card>

            <Card title="Payments" flush className="no-print">
              {inv.payments.length ? (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Date</th><th>Method</th><th>Note</th>{team && <th>Recorded by</th>}<th className="num">Amount</th>{admin && <th aria-label="Actions" />}</tr></thead>
                    <tbody>
                      {inv.payments.map((p) => (
                        <tr key={p.id}>
                          <td>{date(p.paid_on)}</td>
                          <td style={{ textTransform: 'capitalize' }}>{label(p.method)}</td>
                          <td>
                            {p.note ?? '—'}
                            {p.refunded_on && <div className="small"><Badge tone="red">Refunded {date(p.refunded_on)}</Badge> {p.refund_reason}</div>}
                          </td>
                          {team && <td>{p.recorded_by ?? '—'}</td>}
                          <td className="num">{money(p.amount)}</td>
                          {admin && (
                            <td className="right">
                              {!p.refunded_on && ['confirmed', 'paid'].includes(inv.status) && (
                                <button type="button" className="btn btn-sm btn-danger" disabled={Boolean(busy)} onClick={() => refund(p)}>Refund</button>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <div className="card-body muted">No payments recorded yet.</div>}
            </Card>

            <Timeline items={inv.activity} className="no-print" />
          </div>

          {paying && (
            <Modal title={`Record payment for ${inv.number}`} onClose={() => setPaying(false)}>
              <PaymentForm invoice={inv} onDone={() => { setPaying(false); invoice.reload({ silent: true }); }} />
            </Modal>
          )}
        </>
      )}
    </Loadable>
  );
}

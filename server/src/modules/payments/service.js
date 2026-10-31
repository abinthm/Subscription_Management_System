import { query, transaction } from '../../db/pool.js';
import { config } from '../../config.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import { today } from '../../lib/dates.js';
import { sendMail, htmlEmail } from '../../lib/mailer.js';
import * as razorpay from '../../lib/razorpay.js';
import { getInvoice } from '../invoices/service.js';

export async function listPayments({ customerId, method, from, to, q, limit, offset }) {
  const { rows } = await query(
    `SELECT p.id, p.method, p.amount, p.paid_on, p.note, i.id AS invoice_id, i.number AS invoice_number,
            u.name AS customer_name, r.refunded_on, count(*) OVER() AS total_count
       FROM payments p
       JOIN invoices i ON i.id = p.invoice_id
       JOIN users u ON u.id = i.customer_id
       LEFT JOIN refunds r ON r.payment_id = p.id
      WHERE ($1::bigint IS NULL OR i.customer_id = $1)
        AND ($2::payment_method IS NULL OR p.method = $2)
        AND ($3::date IS NULL OR p.paid_on >= $3)
        AND ($4::date IS NULL OR p.paid_on <= $4)
        AND ($5::text IS NULL OR i.number ILIKE '%' || $5 || '%' OR u.name ILIKE '%' || $5 || '%')
      ORDER BY p.paid_on DESC, p.id DESC
      LIMIT $6 OFFSET $7`,
    [customerId, method, from, to, q, limit, offset],
  );
  return rows;
}

export function recordPayment({ invoice_id, method, amount, paid_on, note, gateway_ref = null }, userId) {
  return transaction(async (db) => {
    const { rows } = await db.query('SELECT * FROM invoices WHERE id = $1 FOR UPDATE', [invoice_id]);
    const invoice = rows[0];
    if (!invoice) throw notFound('Invoice');

    // The invoice lock serialises retries of the same gateway payment, so this check cannot race.
    if (gateway_ref) {
      const { rows: existing } = await db.query('SELECT * FROM payments WHERE gateway_ref = $1', [gateway_ref]);
      if (existing[0]) return { ...existing[0], subscription_id: invoice.subscription_id, duplicate: true };
    }
    if (invoice.status !== 'confirmed') throw conflict(`Payments can only be recorded on confirmed invoices (this one is ${invoice.status})`);

    const balance = Math.round((invoice.total - invoice.amount_paid) * 100) / 100;
    if (amount > balance) throw badRequest('Please fix the highlighted fields', { amount: `Cannot exceed the balance of ${balance.toFixed(2)}` });

    const { rows: payment } = await db.query(
      `INSERT INTO payments (invoice_id, method, amount, paid_on, note, recorded_by, gateway_ref)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [invoice_id, method, amount, paid_on, note, userId, gateway_ref],
    );
    await db.query(
      `UPDATE invoices SET amount_paid = amount_paid + $2,
              status = CASE WHEN amount_paid + $2 >= total THEN 'paid'::invoice_status ELSE status END
        WHERE id = $1`,
      [invoice_id, amount],
    );
    return { ...payment[0], subscription_id: invoice.subscription_id };
  });
}

export async function startOnlinePayment(invoiceId, viewer) {
  const invoice = await getInvoice(invoiceId, viewer);
  if (invoice.status !== 'confirmed') throw conflict(`Only confirmed invoices can be paid (this one is ${invoice.status})`);
  const paise = Math.round(invoice.balance * 100);
  if (paise < 100) throw conflict('The balance is too small to pay online');
  const order = await razorpay.createOrder(paise, invoice.number, { invoice_id: String(invoice.id) });
  return { key_id: config.razorpay.keyId, order_id: order.id, amount: order.amount, currency: order.currency };
}

const GATEWAY_METHODS = { upi: 'upi', card: 'card', netbanking: 'bank_transfer' };

export async function completeOnlinePayment({ order_id, payment_id, signature }, viewer) {
  if (!razorpay.signatureValid(order_id, payment_id, signature)) throw badRequest('This payment could not be verified');

  const [order, payment] = await Promise.all([razorpay.fetchOrder(order_id), razorpay.fetchPayment(payment_id)]);
  const invoiceId = Number(order.notes?.invoice_id);
  if (payment.order_id !== order_id || !Number.isInteger(invoiceId)) throw badRequest('This payment could not be verified');
  await getInvoice(invoiceId, viewer);

  if (payment.status === 'authorized') await razorpay.capturePayment(payment_id, payment.amount);
  else if (payment.status !== 'captured') throw conflict(`The payment is ${payment.status}, not completed`);

  // NOTE: if staff record a manual payment between order and checkout, this rejects the overpayment and the gateway charge needs a manual refund
  return recordPayment({
    invoice_id: invoiceId,
    method: GATEWAY_METHODS[payment.method] ?? 'card',
    amount: payment.amount / 100,
    paid_on: today(),
    note: `Razorpay ${payment_id}`,
    gateway_ref: payment_id,
  }, viewer.id);
}

export function refundPayment(paymentId, reason, userId) {
  return transaction(async (db) => {
    const { rows: found } = await db.query('SELECT invoice_id FROM payments WHERE id = $1', [paymentId]);
    if (!found[0]) throw notFound('Payment');
    const { rows: invoices } = await db.query('SELECT * FROM invoices WHERE id = $1 FOR UPDATE', [found[0].invoice_id]);
    const invoice = invoices[0];
    const { rows } = await db.query(
      'SELECT p.*, r.id AS refund_id FROM payments p LEFT JOIN refunds r ON r.payment_id = p.id WHERE p.id = $1',
      [paymentId],
    );
    const payment = rows[0];
    if (payment.refund_id) throw conflict('This payment has already been refunded');
    if (!['confirmed', 'paid'].includes(invoice.status)) throw conflict(`Payments on ${invoice.status} invoices cannot be refunded`);

    const { rows: refund } = await db.query(
      `INSERT INTO refunds (payment_id, amount, reason, refunded_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [paymentId, payment.amount, reason, userId],
    );
    await db.query(
      `UPDATE invoices SET amount_paid = amount_paid - $2,
              status = CASE WHEN status = 'paid' THEN 'confirmed'::invoice_status ELSE status END
        WHERE id = $1`,
      [invoice.id, payment.amount],
    );

    // Books are written first and the gateway goes last, so money only moves once every
    // constraint has passed; a gateway failure rolls the whole refund back.
    if (payment.gateway_ref) {
      const gatewayRefund = await razorpay.refundPayment(payment.gateway_ref, Math.round(payment.amount * 100));
      await db.query('UPDATE refunds SET gateway_ref = $2 WHERE id = $1', [refund[0].id, gatewayRefund.id]);
      refund[0].gateway_ref = gatewayRefund.id;
    }
    return { ...refund[0], invoice_id: invoice.id, subscription_id: invoice.subscription_id };
  });
}

const inr = (n) => `INR ${Number(n).toFixed(2)}`;

export async function sendReceipt(paymentId) {
  const { rows } = await query(
    `SELECT p.amount, p.method, p.paid_on, i.id AS invoice_id, i.number, i.total - i.amount_paid AS balance,
            u.name, u.email
       FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN users u ON u.id = i.customer_id
      WHERE p.id = $1`,
    [paymentId],
  );
  const p = rows[0];
  if (!p) return;
  const method = p.method.replace('_', ' ');
  await sendMail({
    to: p.email,
    subject: `Payment received for invoice ${p.number}`,
    text: `Hi ${p.name},\n\nWe received ${inr(p.amount)} by ${method} on ${p.paid_on} for invoice ${p.number}.\n`
      + `Remaining balance: ${inr(p.balance)}\n\nThank you,\nBrightloop Software`,
    html: htmlEmail({
      heading: 'Payment received',
      paragraphs: [`Hi ${p.name},`, `Thank you. We received your payment for invoice ${p.number}.`],
      rows: [['Amount', inr(p.amount), true], ['Method', method], ['Date', p.paid_on], ['Remaining balance', inr(p.balance)]],
      action: { label: 'View invoice', url: `${config.appUrl}/invoices/${p.invoice_id}` },
    }),
  });
}

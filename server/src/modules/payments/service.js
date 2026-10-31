import { query, transaction } from '../../db/pool.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';

export async function listPayments({ customerId, method, from, to, q, limit, offset }) {
  const { rows } = await query(
    `SELECT p.id, p.method, p.amount, p.paid_on, p.note, i.id AS invoice_id, i.number AS invoice_number,
            u.name AS customer_name, count(*) OVER() AS total_count
       FROM payments p
       JOIN invoices i ON i.id = p.invoice_id
       JOIN users u ON u.id = i.customer_id
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

export function recordPayment({ invoice_id, method, amount, paid_on, note }, userId) {
  return transaction(async (db) => {
    const { rows } = await db.query('SELECT * FROM invoices WHERE id = $1 FOR UPDATE', [invoice_id]);
    const invoice = rows[0];
    if (!invoice) throw notFound('Invoice');
    if (invoice.status !== 'confirmed') throw conflict(`Payments can only be recorded on confirmed invoices (this one is ${invoice.status})`);

    const balance = Math.round((invoice.total - invoice.amount_paid) * 100) / 100;
    if (amount > balance) throw badRequest('Please fix the highlighted fields', { amount: `Cannot exceed the balance of ${balance.toFixed(2)}` });

    const { rows: payment } = await db.query(
      `INSERT INTO payments (invoice_id, method, amount, paid_on, note, recorded_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [invoice_id, method, amount, paid_on, note, userId],
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

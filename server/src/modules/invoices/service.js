import { query, transaction } from '../../db/pool.js';
import { conflict, notFound } from '../../lib/errors.js';
import { addDays, addPeriod, today } from '../../lib/dates.js';
import { priceLines, isDiscountUsable } from '../../lib/pricing.js';
import { sendMail, htmlEmail } from '../../lib/mailer.js';
import { config } from '../../config.js';

const BILLING_BATCH = 200;

export async function listInvoices({ customerId, status, overdue, q, from, to, limit, offset }) {
  const { rows } = await query(
    `SELECT i.id, i.number, i.status, i.issue_date, i.due_date, i.period_start, i.period_end,
            i.total, i.amount_paid, i.total - i.amount_paid AS balance,
            (i.status = 'confirmed' AND i.due_date < CURRENT_DATE) AS is_overdue,
            s.number AS subscription_number, u.name AS customer_name,
            count(*) OVER() AS total_count
       FROM invoices i
       JOIN subscriptions s ON s.id = i.subscription_id
       JOIN users u ON u.id = i.customer_id
      WHERE ($1::bigint IS NULL OR i.customer_id = $1)
        AND ($2::invoice_status IS NULL OR i.status = $2)
        AND (NOT $3 OR (i.status = 'confirmed' AND i.due_date < CURRENT_DATE))
        AND ($4::text IS NULL OR i.number ILIKE '%' || $4 || '%' OR u.name ILIKE '%' || $4 || '%')
        AND ($5::date IS NULL OR i.issue_date >= $5)
        AND ($6::date IS NULL OR i.issue_date <= $6)
      ORDER BY i.id DESC
      LIMIT $7 OFFSET $8`,
    [customerId, status, overdue, q, from, to, limit, offset],
  );
  return rows;
}

export async function getInvoice(id, viewer, db = { query }) {
  const { rows } = await db.query(
    `SELECT i.*, i.total - i.amount_paid AS balance,
            (i.status = 'confirmed' AND i.due_date < CURRENT_DATE) AS is_overdue,
            s.number AS subscription_number, u.name AS customer_name, u.email AS customer_email,
            u.phone AS customer_phone, u.address AS customer_address, d.name AS discount_name
       FROM invoices i
       JOIN subscriptions s ON s.id = i.subscription_id
       JOIN users u ON u.id = i.customer_id
       LEFT JOIN discounts d ON d.id = i.discount_id
      WHERE i.id = $1`,
    [id],
  );
  const invoice = rows[0];
  if (!invoice || (viewer?.role === 'customer' && invoice.customer_id !== viewer.id)) throw notFound('Invoice');
  const [lines, payments] = await Promise.all([
    db.query('SELECT * FROM invoice_lines WHERE invoice_id = $1 ORDER BY id', [id]),
    db.query(
      `SELECT p.id, p.method, p.amount, p.paid_on, p.note, u.name AS recorded_by
         FROM payments p LEFT JOIN users u ON u.id = p.recorded_by
        WHERE p.invoice_id = $1 ORDER BY p.paid_on, p.id`,
      [id],
    ),
  ]);
  return { ...invoice, lines: lines.rows, payments: payments.rows };
}

async function loadDiscount(db, discountId) {
  if (!discountId) return null;
  await db.query('SELECT 1 FROM discounts WHERE id = $1 FOR UPDATE', [discountId]);
  const { rows } = await db.query(
    `SELECT d.*, COALESCE(array_agg(dp.product_id) FILTER (WHERE dp.product_id IS NOT NULL), '{}') AS product_ids
       FROM discounts d LEFT JOIN discount_products dp ON dp.discount_id = d.id
      WHERE d.id = $1 GROUP BY d.id`,
    [discountId],
  );
  return rows[0] ?? null;
}

async function invoiceSubscription(db, subscriptionId, { ahead = false } = {}) {
  const { rows } = await db.query(
    `SELECT s.*, p.billing_period, u.name AS customer_name
       FROM subscriptions s JOIN plans p ON p.id = s.plan_id JOIN users u ON u.id = s.customer_id
      WHERE s.id = $1 FOR UPDATE OF s`,
    [subscriptionId],
  );
  const sub = rows[0];
  if (!sub) throw notFound('Subscription');
  if (sub.status !== 'active') throw conflict('Only active subscriptions can be invoiced');
  if (!ahead && sub.next_invoice_date > today()) throw conflict(`Next invoice is due on ${sub.next_invoice_date}`);
  if (sub.expiry_date && sub.next_invoice_date > sub.expiry_date) throw conflict('Subscription has expired; renew it to keep billing');

  const periodStart = sub.next_invoice_date;
  const nextDate = addPeriod(sub.start_date, sub.billing_period, sub.billed_periods + 1);
  let periodEnd = addDays(nextDate, -1);
  if (sub.expiry_date && periodEnd > sub.expiry_date) periodEnd = sub.expiry_date;

  const { rows: lines } = await db.query(
    `SELECT l.product_id, l.quantity, l.unit_price, COALESCE(t.rate, 0) AS tax_rate,
            pr.name || COALESCE(' (' || v.attribute || ': ' || v.value || ')', '') AS description
       FROM subscription_lines l
       JOIN products pr ON pr.id = l.product_id
       LEFT JOIN product_variants v ON v.id = l.variant_id
       LEFT JOIN taxes t ON t.id = l.tax_id
      WHERE l.subscription_id = $1 ORDER BY l.id`,
    [sub.id],
  );
  if (!lines.length) throw conflict(`${sub.number} has no product lines to bill`);

  const discount = await loadDiscount(db, sub.discount_id);
  const priced = priceLines(lines, isDiscountUsable(discount, periodStart) ? discount : null);

  const { rows: inserted } = await db.query(
    `INSERT INTO invoices (subscription_id, customer_id, period_start, period_end, due_date,
                           subtotal, discount_total, tax_total, total, discount_id)
     VALUES ($1, $2, $3, $4, CURRENT_DATE + $5::int, $6, $7, $8, $9, $10)
     ON CONFLICT (subscription_id, period_start) WHERE status <> 'cancelled' DO NOTHING
     RETURNING id`,
    [sub.id, sub.customer_id, periodStart, periodEnd, sub.payment_terms_days,
      priced.subtotal, priced.discount_total, priced.tax_total, priced.total,
      priced.discount_applied ? discount.id : null],
  );

  if (inserted[0]) {
    for (const l of priced.lines) {
      await db.query(
        `INSERT INTO invoice_lines (invoice_id, product_id, description, quantity, unit_price, discount_amount, tax_rate, tax_amount, amount)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [inserted[0].id, l.product_id, l.description, l.quantity, l.unit_price, l.discount_amount, l.tax_rate, l.tax_amount, l.amount],
      );
    }
    if (priced.discount_applied) {
      await db.query('UPDATE discounts SET used_count = used_count + 1 WHERE id = $1', [discount.id]);
    }
  }

  await db.query(
    'UPDATE subscriptions SET billed_periods = billed_periods + 1, next_invoice_date = $2, updated_at = now() WHERE id = $1',
    [sub.id, nextDate],
  );
  return inserted[0]?.id ?? null;
}

export async function invoiceNow(subscriptionId, viewer) {
  const invoiceId = await transaction((db) => invoiceSubscription(db, subscriptionId, { ahead: true }));
  if (!invoiceId) throw conflict('This period has already been invoiced');
  return getInvoice(invoiceId, viewer);
}

export async function runBilling() {
  const failed = new Map();
  let created = 0;

  for (;;) {
    const { rows } = await query(
      `SELECT id FROM subscriptions
        WHERE status = 'active' AND next_invoice_date <= CURRENT_DATE
          AND (expiry_date IS NULL OR next_invoice_date <= expiry_date)
          AND NOT (id = ANY($1::bigint[]))
        ORDER BY next_invoice_date LIMIT $2`,
      [[...failed.keys()], BILLING_BATCH],
    );
    if (!rows.length) break;
    for (const { id } of rows) {
      try {
        if (await transaction((db) => invoiceSubscription(db, id))) created += 1;
      } catch (err) {
        failed.set(id, err.message);
      }
    }
  }

  return { created, failed: [...failed].map(([subscription_id, reason]) => ({ subscription_id, reason })) };
}

const TRANSITIONS = {
  confirm: { from: ['draft'], to: 'confirmed' },
  cancel: { from: ['draft', 'confirmed'], to: 'cancelled' },
};

export function changeStatus(id, action, viewer) {
  const rule = TRANSITIONS[action];
  return transaction(async (db) => {
    const { rows } = await db.query('SELECT * FROM invoices WHERE id = $1 FOR UPDATE', [id]);
    const invoice = rows[0];
    if (!invoice) throw notFound('Invoice');
    if (!rule.from.includes(invoice.status)) throw conflict(`Cannot ${action} an invoice that is ${invoice.status}`);
    if (action === 'cancel' && Number(invoice.amount_paid) > 0) throw conflict('Invoices with payments cannot be cancelled');

    await db.query('UPDATE invoices SET status = $2 WHERE id = $1', [id, rule.to]);
    if (action === 'cancel' && invoice.discount_id) {
      await db.query('UPDATE discounts SET used_count = GREATEST(used_count - 1, 0) WHERE id = $1', [invoice.discount_id]);
    }
    return getInvoice(id, viewer, db);
  });
}

const fmt = (n) => Number(n).toFixed(2);

export async function sendInvoice(id, viewer) {
  const invoice = await getInvoice(id, viewer);
  if (!['confirmed', 'paid'].includes(invoice.status)) throw conflict('Confirm the invoice before sending it');
  const lines = invoice.lines.map((l) => `  ${l.description} x${l.quantity}  ${fmt(l.amount)}`).join('\n');
  await sendMail({
    to: invoice.customer_email,
    subject: `Invoice ${invoice.number} from Brightloop Software`,
    text: `Hi ${invoice.customer_name},\n\nInvoice ${invoice.number} for ${invoice.period_start} to ${invoice.period_end}:\n\n${lines}\n\n`
      + `Subtotal ${fmt(invoice.subtotal)}\nDiscount -${fmt(invoice.discount_total)}\nTax ${fmt(invoice.tax_total)}\n`
      + `Total ${fmt(invoice.total)}\nBalance due ${fmt(invoice.balance)} by ${invoice.due_date}\n\nThank you,\nBrightloop Software`,
    html: htmlEmail({
      heading: `Invoice ${invoice.number}`,
      paragraphs: [`Hi ${invoice.customer_name},`, `Here is your invoice for ${invoice.period_start} to ${invoice.period_end}.`],
      rows: [
        ...invoice.lines.map((l) => [`${l.description} x${l.quantity}`, fmt(l.amount)]),
        ['Subtotal', fmt(invoice.subtotal)],
        ['Discount', `-${fmt(invoice.discount_total)}`],
        ['Tax', fmt(invoice.tax_total)],
        ['Total', fmt(invoice.total), true],
        [`Balance due by ${invoice.due_date}`, fmt(invoice.balance), true],
      ],
      action: { label: 'View and pay invoice', url: `${config.appUrl}/invoices/${invoice.id}` },
    }),
  });
  await query('UPDATE invoices SET sent_at = now() WHERE id = $1', [id]);
  return { ...invoice, sent_at: new Date().toISOString() };
}

const REMINDER_BATCH = 200;

export async function sendOverdueReminders() {
  const { rows } = await query(
    `SELECT i.id, i.number, i.due_date, i.total - i.amount_paid AS balance, u.name, u.email
       FROM invoices i JOIN users u ON u.id = i.customer_id
      WHERE i.status = 'confirmed' AND i.due_date < CURRENT_DATE
        AND NOT EXISTS (SELECT 1 FROM email_log l WHERE l.kind = 'overdue' AND l.invoice_id = i.id)
      ORDER BY i.id LIMIT $1`,
    [REMINDER_BATCH],
  );
  let sent = 0;
  for (const inv of rows) {
    const claimed = await query(
      "INSERT INTO email_log (kind, invoice_id) VALUES ('overdue', $1) ON CONFLICT DO NOTHING",
      [inv.id],
    );
    if (!claimed.rowCount) continue;
    try {
      await sendMail({
        to: inv.email,
        subject: `Reminder: invoice ${inv.number} is overdue`,
        text: `Hi ${inv.name},\n\nInvoice ${inv.number} was due on ${inv.due_date} and has ${fmt(inv.balance)} outstanding.\n`
          + `You can pay it here: ${config.appUrl}/invoices/${inv.id}\n\nThank you,\nBrightloop Software`,
        html: htmlEmail({
          heading: `Invoice ${inv.number} is overdue`,
          paragraphs: [`Hi ${inv.name},`, `This invoice was due on ${inv.due_date}. If you have already paid, please ignore this reminder.`],
          rows: [['Outstanding', fmt(inv.balance), true]],
          action: { label: 'Pay now', url: `${config.appUrl}/invoices/${inv.id}` },
        }),
      });
      sent += 1;
    } catch {
      await query("DELETE FROM email_log WHERE kind = 'overdue' AND invoice_id = $1", [inv.id]);
    }
  }
  return sent;
}

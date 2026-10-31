import { query, transaction } from '../../db/pool.js';
import { conflict, notFound } from '../../lib/errors.js';
import { addDays, addPeriod, today } from '../../lib/dates.js';
import { priceLines, isDiscountUsable, planFeeLine } from '../../lib/pricing.js';
import { sendMail, htmlEmail } from '../../lib/mailer.js';
import { config } from '../../config.js';
import { activityFor, inr, logActivity } from '../../lib/activity.js';
import { keysetPage } from '../../db/paging.js';

const BILLING_WORKERS = 4;

export function listInvoices({ customerId, status, overdue, q, from, to, limit, cursor, count }) {
  return keysetPage({
    select: `i.id, i.number, i.status, i.issue_date, i.due_date, i.period_start, i.period_end,
             i.total, i.amount_paid, i.total - i.amount_paid AS balance,
             (i.status = 'confirmed' AND i.due_date < CURRENT_DATE) AS is_overdue,
             s.number AS subscription_number, u.name AS customer_name`,
    from: 'invoices i',
    joins: `JOIN subscriptions s ON s.id = i.subscription_id
            JOIN users u ON u.id = i.customer_id`,
    where: `($1::bigint IS NULL OR i.customer_id = $1)
            AND ($2::invoice_status IS NULL OR i.status = $2)
            AND (NOT $3 OR (i.status = 'confirmed' AND i.due_date < CURRENT_DATE))
            AND ($4::text IS NULL OR i.number ILIKE '%' || $4 || '%'
                 OR i.customer_id IN (SELECT id FROM users WHERE name ILIKE '%' || $4 || '%'))
            AND ($5::date IS NULL OR i.issue_date >= $5)
            AND ($6::date IS NULL OR i.issue_date <= $6)`,
    params: [customerId, status, overdue, q, from, to],
    keys: [{ col: 'i.id', field: 'id', type: 'bigint' }],
    cursor,
    limit,
    count,
  });
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
      `SELECT p.id, p.method, p.amount, p.paid_on, p.note, u.name AS recorded_by, r.refunded_on, r.reason AS refund_reason
         FROM payments p LEFT JOIN users u ON u.id = p.recorded_by LEFT JOIN refunds r ON r.payment_id = p.id
        WHERE p.invoice_id = $1 ORDER BY p.paid_on, p.id`,
      [id],
    ),
  ]);
  return { ...invoice, lines: lines.rows, payments: payments.rows, activity: await activityFor(db, 'invoice', id) };
}

async function loadDiscount(db, discountId) {
  if (!discountId) return null;
  const { rows } = await db.query(
    `SELECT d.*, ARRAY(SELECT product_id FROM discount_products WHERE discount_id = d.id) AS product_ids
       FROM discounts d WHERE d.id = $1 FOR UPDATE`,
    [discountId],
  );
  return rows[0] ?? null;
}

export async function invoiceSubscription(db, subscriptionId, { ahead = false, actorId = null } = {}) {
  const { rows } = await db.query(
    `SELECT s.*, p.billing_period, p.name AS plan_name, p.price AS plan_price, COALESCE(pt.rate, 0) AS plan_tax_rate
       FROM subscriptions s
       JOIN plans p ON p.id = s.plan_id
       LEFT JOIN taxes pt ON pt.id = p.tax_id
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

  const { rows: productLines } = await db.query(
    `SELECT l.product_id, l.quantity, l.unit_price, COALESCE(t.rate, 0) AS tax_rate,
            pr.name || COALESCE(' (' || v.attribute || ': ' || v.value || ')', '') AS description
       FROM subscription_lines l
       JOIN products pr ON pr.id = l.product_id
       LEFT JOIN product_variants v ON v.id = l.variant_id
       LEFT JOIN taxes t ON t.id = l.tax_id
      WHERE l.subscription_id = $1 ORDER BY l.id`,
    [sub.id],
  );
  if (!productLines.length) throw conflict(`${sub.number} has no product lines to bill`);
  const lines = [...planFeeLine({ name: sub.plan_name, price: sub.plan_price }, sub.plan_tax_rate), ...productLines];

  const discount = await loadDiscount(db, sub.discount_id);
  const priced = priceLines(lines, isDiscountUsable(discount, periodStart) ? discount : null);

  const { rows: inserted } = await db.query(
    `INSERT INTO invoices (subscription_id, customer_id, period_start, period_end, due_date,
                           subtotal, discount_total, tax_total, total, discount_id)
     VALUES ($1, $2, $3, $4, CURRENT_DATE + $5::int, $6, $7, $8, $9, $10)
     ON CONFLICT (subscription_id, period_start) WHERE status <> 'cancelled' DO NOTHING
     RETURNING id, number`,
    [sub.id, sub.customer_id, periodStart, periodEnd, sub.payment_terms_days,
      priced.subtotal, priced.discount_total, priced.tax_total, priced.total,
      priced.discount_applied ? discount.id : null],
  );

  if (inserted[0]) {
    const col = (key) => priced.lines.map((l) => l[key]);
    await db.query(
      `INSERT INTO invoice_lines (invoice_id, product_id, description, quantity, unit_price, discount_amount, tax_rate, tax_amount, amount)
       SELECT $1, * FROM unnest($2::bigint[], $3::text[], $4::int[], $5::numeric[], $6::numeric[], $7::numeric[], $8::numeric[], $9::numeric[])`,
      [inserted[0].id, col('product_id'), col('description'), col('quantity'), col('unit_price'),
        col('discount_amount'), col('tax_rate'), col('tax_amount'), col('amount')],
    );
    if (periodStart < `${today().slice(0, 8)}01`) {
      await db.query('DELETE FROM mrr_snapshot_runs WHERE snapshot_date BETWEEN $1 AND $2', [periodStart, periodEnd]);
    }
    if (priced.discount_applied) {
      await db.query('UPDATE discounts SET used_count = used_count + 1 WHERE id = $1', [discount.id]);
    }
    await logActivity(db, {
      subscriptionId: sub.id, invoiceId: inserted[0].id, actorId, action: 'invoiced',
      message: `Invoice ${inserted[0].number} created for ${periodStart} to ${periodEnd}, ${inr(priced.total)}`
        + (priced.discount_applied ? ` with discount "${discount.name}"` : ''),
    });
  }

  await db.query(
    'UPDATE subscriptions SET billed_periods = billed_periods + 1, next_invoice_date = $2, updated_at = now() WHERE id = $1',
    [sub.id, nextDate],
  );
  return inserted[0]?.id ?? null;
}

export async function invoiceNow(subscriptionId, viewer) {
  const invoiceId = await transaction((db) => invoiceSubscription(db, subscriptionId, { ahead: true, actorId: viewer.id }));
  if (!invoiceId) throw conflict('This period has already been invoiced');
  return getInvoice(invoiceId, viewer);
}

// Workers claim due subscriptions with SKIP LOCKED, so they never wait on or double-bill each other,
// and the same holds if several instances bill at once.
export async function runBilling() {
  const failed = new Map();
  let created = 0;

  const worker = async () => {
    for (;;) {
      let claimed = null;
      try {
        const invoiceId = await transaction(async (db) => {
          const { rows } = await db.query(
            `SELECT id FROM subscriptions
              WHERE status = 'active' AND next_invoice_date <= CURRENT_DATE
                AND (expiry_date IS NULL OR next_invoice_date <= expiry_date)
                AND NOT (id = ANY($1::bigint[]))
              ORDER BY next_invoice_date LIMIT 1
              FOR UPDATE SKIP LOCKED`,
            [[...failed.keys()]],
          );
          if (!rows[0]) return undefined;
          claimed = rows[0].id;
          return invoiceSubscription(db, claimed);
        });
        if (invoiceId === undefined) return;
        if (invoiceId) created += 1;
      } catch (err) {
        if (claimed === null) throw err;
        failed.set(claimed, err.message);
      }
    }
  };
  await Promise.all(Array.from({ length: BILLING_WORKERS }, worker));

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
    if (action === 'cancel') {
      await db.query('DELETE FROM mrr_snapshot_runs WHERE snapshot_date BETWEEN $1 AND $2', [invoice.period_start, invoice.period_end]);
    }
    if (action === 'cancel' && invoice.discount_id) {
      await db.query('UPDATE discounts SET used_count = GREATEST(used_count - 1, 0) WHERE id = $1', [invoice.discount_id]);
    }
    await logActivity(db, {
      subscriptionId: invoice.subscription_id, invoiceId: id, actorId: viewer.id, action: `invoice_${action}`,
      message: `Invoice ${invoice.number} ${action === 'cancel' ? 'cancelled' : 'confirmed'}`,
    });
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
  await logActivity({ query }, {
    subscriptionId: invoice.subscription_id, invoiceId: id, actorId: viewer.id, action: 'invoice_sent',
    message: `Invoice ${invoice.number} emailed to ${invoice.customer_email}`,
  });
  return { ...invoice, sent_at: new Date().toISOString() };
}

const REMINDER_BATCH = 200;

// Windows are days past due; invoices older than 30 days are left to staff follow-up rather than more email.
const REMINDERS = [
  {
    kind: 'overdue',
    days: [1, 13],
    subject: (n) => `Reminder: invoice ${n} is overdue`,
    note: 'If you have already paid, please ignore this reminder.',
  },
  {
    kind: 'final_notice',
    days: [14, 30],
    subject: (n) => `Final notice: invoice ${n} is overdue`,
    note: 'This is our final reminder. Please pay now to keep your subscription running.',
  },
];

async function sendReminders({ kind, days, subject, note }) {
  const { rows } = await query(
    `SELECT i.id, i.number, i.due_date, i.total - i.amount_paid AS balance, u.name, u.email
       FROM invoices i JOIN users u ON u.id = i.customer_id
      WHERE i.status = 'confirmed' AND CURRENT_DATE - i.due_date BETWEEN $2 AND $3
        AND NOT EXISTS (SELECT 1 FROM email_log l WHERE l.kind = $1 AND l.invoice_id = i.id)
      ORDER BY i.due_date LIMIT $4`,
    [kind, days[0], days[1], REMINDER_BATCH],
  );
  let sent = 0;
  for (const inv of rows) {
    const claimed = await query('INSERT INTO email_log (kind, invoice_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [kind, inv.id]);
    if (!claimed.rowCount) continue;
    const link = `${config.appUrl}/invoices/${inv.id}`;
    try {
      await sendMail({
        to: inv.email,
        subject: subject(inv.number),
        text: `Hi ${inv.name},\n\nInvoice ${inv.number} was due on ${inv.due_date} and has ${fmt(inv.balance)} outstanding.\n`
          + `${note}\nYou can pay it here: ${link}\n\nThank you,\nBrightloop Software`,
        html: htmlEmail({
          heading: subject(inv.number),
          paragraphs: [`Hi ${inv.name},`, `This invoice was due on ${inv.due_date}.`, note],
          rows: [['Outstanding', fmt(inv.balance), true]],
          action: { label: 'Pay now', url: link },
        }),
      });
      sent += 1;
    } catch {
      await query('DELETE FROM email_log WHERE kind = $1 AND invoice_id = $2', [kind, inv.id]);
    }
  }
  return sent;
}

export async function sendOverdueReminders() {
  let sent = 0;
  for (const reminder of REMINDERS) sent += await sendReminders(reminder);
  return sent;
}

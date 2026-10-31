import { query, transaction } from '../../db/pool.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { addDays, addPeriod, today } from '../../lib/dates.js';
import { priceLines, isDiscountUsable, planFeeLine } from '../../lib/pricing.js';
import { getDiscount } from '../discounts/service.js';
import { invoiceSubscription } from '../invoices/service.js';

const EDITABLE = ['draft', 'quotation'];

const ACTIONS = {
  send: { from: ['draft'], to: 'quotation' },
  confirm: { from: ['draft', 'quotation'], to: 'confirmed' },
  activate: { from: ['confirmed'], to: 'active' },
  pause: { from: ['active'], to: 'paused', planFlag: 'pausable' },
  resume: { from: ['paused'], to: 'active' },
  close: { from: ['draft', 'quotation', 'confirmed', 'active', 'paused'], to: 'closed' },
  renew: { from: ['active'], planFlag: 'renewable' },
};

export const ACTION_NAMES = Object.keys(ACTIONS);
const CUSTOMER_ACTIONS = ['confirm', 'pause', 'resume', 'close', 'renew'];

export async function listSubscriptions({ customerId, status, planId, q, limit, offset }) {
  const { rows } = await query(
    `SELECT s.id, s.number, s.status, s.start_date, s.expiry_date, s.next_invoice_date, s.valid_until,
            u.id AS customer_id, u.name AS customer_name, p.name AS plan_name, p.billing_period,
            p.price + COALESCE(t.recurring, 0) AS recurring_amount,
            count(*) OVER() AS total_count
       FROM subscriptions s
       JOIN users u ON u.id = s.customer_id
       JOIN plans p ON p.id = s.plan_id
       LEFT JOIN LATERAL (
         SELECT sum(l.quantity * l.unit_price) AS recurring FROM subscription_lines l WHERE l.subscription_id = s.id
       ) t ON true
      WHERE ($1::bigint IS NULL OR s.customer_id = $1)
        AND ($2::sub_status IS NULL OR s.status = $2)
        AND ($3::bigint IS NULL OR s.plan_id = $3)
        AND ($4::text IS NULL OR s.number ILIKE '%' || $4 || '%' OR u.name ILIKE '%' || $4 || '%')
      ORDER BY s.id DESC
      LIMIT $5 OFFSET $6`,
    [customerId, status, planId, q, limit, offset],
  );
  return rows;
}

async function loadLines(db, subscriptionId) {
  const { rows } = await db.query(
    `SELECT l.id, l.product_id, pr.name AS product_name, l.variant_id,
            v.attribute || ': ' || v.value AS variant_label,
            l.quantity, l.unit_price, l.tax_id, COALESCE(t.rate, 0) AS tax_rate, t.name AS tax_name
       FROM subscription_lines l
       JOIN products pr ON pr.id = l.product_id
       LEFT JOIN product_variants v ON v.id = l.variant_id
       LEFT JOIN taxes t ON t.id = l.tax_id
      WHERE l.subscription_id = $1 ORDER BY l.id`,
    [subscriptionId],
  );
  return rows;
}

export async function getSubscription(id, viewer, db = { query }) {
  const { rows } = await db.query(
    `SELECT s.*, u.name AS customer_name, u.email AS customer_email,
            row_to_json(p) AS plan, d.name AS discount_name, pt.name AS plan_tax_name, COALESCE(pt.rate, 0) AS plan_tax_rate
       FROM subscriptions s
       JOIN users u ON u.id = s.customer_id
       JOIN plans p ON p.id = s.plan_id
       LEFT JOIN taxes pt ON pt.id = p.tax_id
       LEFT JOIN discounts d ON d.id = s.discount_id
      WHERE s.id = $1`,
    [id],
  );
  const sub = rows[0];
  if (!sub || (viewer?.role === 'customer' && sub.customer_id !== viewer.id)) throw notFound('Subscription');

  const lines = await loadLines(db, id);
  const { rows: invoices } = await db.query(
    `SELECT id, number, status, period_start, period_end, due_date, total, amount_paid
       FROM invoices WHERE subscription_id = $1 ORDER BY period_start DESC, id DESC`,
    [id],
  );
  const discount = sub.discount_id ? await getDiscount(sub.discount_id, db) : null;
  const fee = planFeeLine(sub.plan, sub.plan_tax_rate).map((l) => ({ ...l, id: 'plan', product_name: l.description, tax_name: sub.plan_tax_name }));
  const { lines: pricedLines, ...totals } = priceLines([...fee, ...lines], isDiscountUsable(discount, today()) ? discount : null);
  return { ...sub, lines: pricedLines, totals, invoices };
}

async function priceRequestedLines(db, lines, plan) {
  const productIds = [...new Set(lines.map((l) => l.product_id))];
  const { rows: products } = await db.query(
    'SELECT id, name, sales_price, tax_id, active FROM products WHERE id = ANY($1::bigint[])',
    [productIds],
  );
  const byId = new Map(products.map((p) => [p.id, p]));
  const variantIds = lines.map((l) => l.variant_id).filter(Boolean);
  const { rows: variants } = await db.query(
    'SELECT id, product_id, extra_price FROM product_variants WHERE id = ANY($1::bigint[])',
    [variantIds],
  );
  const variantsById = new Map(variants.map((v) => [v.id, v]));

  return lines.map((l, i) => {
    const product = byId.get(l.product_id);
    if (!product || !product.active) throw badRequest(`Line ${i + 1}: product is not available`);
    const variant = l.variant_id ? variantsById.get(l.variant_id) : null;
    if (l.variant_id && variant?.product_id !== l.product_id) {
      throw badRequest(`Line ${i + 1}: variant does not belong to ${product.name}`);
    }
    if (l.quantity < plan.min_quantity) {
      throw badRequest(`Line ${i + 1}: the ${plan.name} plan needs at least ${plan.min_quantity} units`);
    }
    return {
      product_id: l.product_id,
      variant_id: l.variant_id ?? null,
      quantity: l.quantity,
      unit_price: Number(product.sales_price) + Number(variant?.extra_price ?? 0),
      tax_id: product.tax_id,
    };
  });
}

async function loadPlanForSale(db, planId, startDate) {
  const { rows } = await db.query('SELECT * FROM plans WHERE id = $1', [planId]);
  const plan = rows[0];
  if (!plan || !plan.active) throw badRequest('Plan is not available');
  if (startDate < plan.start_date || (plan.end_date && startDate > plan.end_date)) {
    throw badRequest(`The ${plan.name} plan is only available from ${plan.start_date}${plan.end_date ? ` to ${plan.end_date}` : ''}`);
  }
  return plan;
}

async function assertCustomer(db, customerId) {
  const { rows } = await db.query("SELECT 1 FROM users WHERE id = $1 AND role = 'customer'", [customerId]);
  if (!rows[0]) throw badRequest('Customer not found');
}

async function writeLines(db, subscriptionId, lines) {
  await db.query('DELETE FROM subscription_lines WHERE subscription_id = $1', [subscriptionId]);
  for (const l of lines) {
    await db.query(
      `INSERT INTO subscription_lines (subscription_id, product_id, variant_id, quantity, unit_price, tax_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [subscriptionId, l.product_id, l.variant_id, l.quantity, l.unit_price, l.tax_id],
    );
  }
}

export function createSubscription(input, viewer) {
  return transaction(async (db) => {
    await assertCustomer(db, input.customer_id);
    const plan = await loadPlanForSale(db, input.plan_id, input.start_date);
    const lines = await priceRequestedLines(db, input.lines, plan);
    const { rows } = await db.query(
      `INSERT INTO subscriptions (customer_id, plan_id, discount_id, start_date, expiry_date, payment_terms_days, valid_until, notes, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [input.customer_id, plan.id, input.discount_id, input.start_date, input.expiry_date,
        input.payment_terms_days, input.valid_until, input.notes, input.status ?? 'draft'],
    );
    await writeLines(db, rows[0].id, lines);
    return getSubscription(rows[0].id, viewer, db);
  });
}

export function subscribe({ plan_id, lines }, viewer) {
  return transaction(async (db) => {
    const start = today();
    const plan = await loadPlanForSale(db, plan_id, start);
    const priced = await priceRequestedLines(db, lines, plan);
    const { rows } = await db.query(
      `INSERT INTO subscriptions (customer_id, plan_id, status, start_date, next_invoice_date, payment_terms_days)
       VALUES ($1, $2, 'active', $3, $3, 7) RETURNING id, number`,
      [viewer.id, plan.id, start],
    );
    const sub = rows[0];
    await writeLines(db, sub.id, priced);
    const invoiceId = await invoiceSubscription(db, sub.id);
    await db.query("UPDATE invoices SET status = 'confirmed' WHERE id = $1", [invoiceId]);
    return { id: sub.id, number: sub.number, invoice_id: invoiceId };
  });
}

export function updateSubscription(id, input, viewer) {
  return transaction(async (db) => {
    const { rows } = await db.query('SELECT status FROM subscriptions WHERE id = $1 FOR UPDATE', [id]);
    if (!rows[0]) throw notFound('Subscription');
    if (!EDITABLE.includes(rows[0].status)) throw conflict('Only draft or quotation subscriptions can be edited');
    await assertCustomer(db, input.customer_id);
    const plan = await loadPlanForSale(db, input.plan_id, input.start_date);
    const lines = await priceRequestedLines(db, input.lines, plan);
    await db.query(
      `UPDATE subscriptions
          SET customer_id=$2, plan_id=$3, discount_id=$4, start_date=$5, expiry_date=$6,
              payment_terms_days=$7, valid_until=$8, notes=$9, updated_at=now()
        WHERE id = $1`,
      [id, input.customer_id, plan.id, input.discount_id, input.start_date, input.expiry_date,
        input.payment_terms_days, input.valid_until, input.notes],
    );
    await writeLines(db, id, lines);
    return getSubscription(id, viewer, db);
  });
}

export async function createFromTemplate({ template_id, customer_id, start_date }, viewer) {
  const { rows } = await query('SELECT * FROM quotation_templates WHERE id = $1', [template_id]);
  const template = rows[0];
  if (!template) throw notFound('Quotation template');
  const { rows: lines } = await query(
    'SELECT product_id, variant_id, quantity FROM quotation_template_lines WHERE template_id = $1 ORDER BY id',
    [template_id],
  );
  return createSubscription({
    status: 'quotation',
    customer_id,
    plan_id: template.plan_id,
    discount_id: null,
    start_date,
    expiry_date: null,
    payment_terms_days: 15,
    valid_until: addDays(today(), template.validity_days),
    notes: template.notes,
    lines,
  }, viewer);
}

function nextBillingAfterResume(sub, plan) {
  let periods = sub.billed_periods;
  let next = addPeriod(sub.start_date, plan.billing_period, periods);
  while (next < today()) {
    periods += 1;
    next = addPeriod(sub.start_date, plan.billing_period, periods);
  }
  return { periods, next };
}

export function runAction(id, action, viewer) {
  const rule = ACTIONS[action];
  if (!rule) throw badRequest(`Unknown action "${action}"`);
  if (viewer.role === 'customer' && !CUSTOMER_ACTIONS.includes(action)) throw forbidden();

  return transaction(async (db) => {
    const { rows } = await db.query(
      `SELECT s.*, row_to_json(p) AS plan FROM subscriptions s JOIN plans p ON p.id = s.plan_id
        WHERE s.id = $1 FOR UPDATE OF s`,
      [id],
    );
    const sub = rows[0];
    if (!sub || (viewer.role === 'customer' && sub.customer_id !== viewer.id)) throw notFound('Subscription');
    if (!rule.from.includes(sub.status)) throw conflict(`Cannot ${action} a subscription that is ${sub.status}`);
    if (rule.planFlag && !sub.plan[rule.planFlag]) throw conflict(`The ${sub.plan.name} plan does not allow this`);
    const running = ['active', 'paused'].includes(sub.status);
    if (action === 'close' && running && !sub.plan.closable) throw conflict(`The ${sub.plan.name} plan cannot be closed early`);

    const { rows: lineCount } = await db.query('SELECT count(*)::int AS n FROM subscription_lines WHERE subscription_id = $1', [id]);
    if (['send', 'confirm'].includes(action) && !lineCount[0].n) throw conflict('Add at least one product line first');
    if (action === 'confirm' && sub.valid_until && sub.valid_until < today()) throw conflict('This quotation has expired');

    switch (action) {
      case 'send':
        await db.query(
          "UPDATE subscriptions SET status='quotation', valid_until=COALESCE(valid_until, CURRENT_DATE + 30), updated_at=now() WHERE id=$1",
          [id],
        );
        break;
      case 'activate':
        await db.query(
          "UPDATE subscriptions SET status='active', billed_periods=0, next_invoice_date=start_date, updated_at=now() WHERE id=$1",
          [id],
        );
        break;
      case 'resume': {
        const { periods, next } = nextBillingAfterResume(sub, sub.plan);
        await db.query(
          "UPDATE subscriptions SET status='active', billed_periods=$2, next_invoice_date=$3, updated_at=now() WHERE id=$1",
          [id, periods, next],
        );
        break;
      }
      case 'renew': {
        if (!sub.expiry_date) throw conflict('This subscription has no expiry date to renew');
        const termDays = Math.round((Date.parse(sub.expiry_date) - Date.parse(sub.start_date)) / 86_400_000);
        await db.query('UPDATE subscriptions SET expiry_date=$2, updated_at=now() WHERE id=$1', [
          id, addDays(sub.expiry_date, Math.max(termDays, 1)),
        ]);
        break;
      }
      default:
        await db.query('UPDATE subscriptions SET status=$2, updated_at=now() WHERE id=$1', [id, rule.to]);
    }
    return getSubscription(id, viewer, db);
  });
}

export async function closeExpired() {
  const { rowCount } = await query(
    `UPDATE subscriptions s SET status = 'closed', updated_at = now()
       FROM plans p
      WHERE p.id = s.plan_id AND p.auto_close
        AND s.status IN ('active', 'paused') AND s.expiry_date < CURRENT_DATE`,
  );
  return rowCount;
}

export async function expireQuotations() {
  const { rowCount } = await query(
    `UPDATE subscriptions SET status = 'closed', updated_at = now()
      WHERE status = 'quotation' AND valid_until < CURRENT_DATE`,
  );
  return rowCount;
}

export async function activateDue() {
  const { rowCount } = await query(
    `UPDATE subscriptions SET status = 'active', billed_periods = 0, next_invoice_date = start_date, updated_at = now()
      WHERE status = 'confirmed' AND start_date <= CURRENT_DATE`,
  );
  return rowCount;
}

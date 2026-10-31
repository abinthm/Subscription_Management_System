import { pool, query } from './pool.js';
import { migrate } from './migrate.js';
import { hashPassword } from '../lib/password.js';
import { addDays, addPeriod, today } from '../lib/dates.js';
import { runBilling } from '../modules/invoices/service.js';

const CUSTOMERS = Number(process.env.SEED_CUSTOMERS ?? 1800);
const HISTORY_DAYS = 730;
const MONTHLY_CHURN = 0.025;

// Fixed-seed PRNG so every reset produces the same demo business and the same insights.
let state = 20261031;
function rand() {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const between = (min, max) => min + Math.floor(rand() * (max - min + 1));
const chance = (p) => rand() < p;

async function insert(table, row) {
  const keys = Object.keys(row);
  const { rows } = await query(
    `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
    Object.values(row),
  );
  return rows[0].id;
}

async function seed() {
  await migrate();
  const { rows } = await query('SELECT count(*)::int AS n FROM users');
  if (rows[0].n) {
    console.log('Database already has data; drop it first to reseed (npm run db:reset).');
    return;
  }

  const adminHash = await hashPassword('Admin@1234');
  const staffHash = await hashPassword('Staff@1234');
  const customerHash = await hashPassword('Customer@1234');

  await insert('users', { name: 'Ada Admin', email: 'admin@brightloop.io', password_hash: adminHash, role: 'admin' });
  await insert('users', { name: 'Sam Staff', email: 'staff@brightloop.io', password_hash: staffHash, role: 'staff' });

  const firstNames = ['Arjun', 'Maya', 'Liam', 'Zara', 'Noah', 'Isha', 'Omar', 'Lena', 'Ravi', 'Chloe', 'Kenji', 'Amara'];
  const companies = ['Retail', 'Logistics', 'Studio', 'Foods', 'Labs', 'Traders', 'Clinic', 'Works', 'Digital', 'Exports'];
  const customerIds = [];
  customerIds.push(await insert('users', {
    name: 'Demo Customer', email: 'customer@brightloop.io', password_hash: customerHash, role: 'customer', phone: '+91 98765 43210',
  }));
  for (let i = 1; i < CUSTOMERS; i += 1) {
    customerIds.push(await insert('users', {
      name: `${pick(firstNames)} ${pick(companies)} ${i}`,
      email: `customer${i}@example.com`,
      password_hash: customerHash,
      role: 'customer',
    }));
  }

  const gst = await insert('taxes', { name: 'GST 18%', rate: 18 });
  const reduced = await insert('taxes', { name: 'GST 5%', rate: 5 });
  await insert('taxes', { name: 'Exempt', rate: 0 });

  const products = [];
  for (const [name, price, cost, tax] of [
    ['CRM Suite', 1200, 300, gst], ['Accounting Cloud', 900, 200, gst], ['Inventory Pro', 750, 180, gst],
    ['Extra Storage 100GB', 150, 20, gst], ['Priority Support', 400, 120, reduced], ['Analytics Add-on', 300, 60, gst],
  ]) {
    products.push(await insert('products', { name, type: 'service', sales_price: price, cost_price: cost, tax_id: tax, notes: `${name} licence per seat` }));
  }
  await insert('product_variants', { product_id: products[0], attribute: 'Brand', value: 'Odoo', extra_price: 560 });
  await insert('product_variants', { product_id: products[0], attribute: 'Brand', value: 'Standard', extra_price: 0 });
  await insert('product_variants', { product_id: products[1], attribute: 'Edition', value: 'Enterprise', extra_price: 400 });

  const yearAgo = addDays(today(), -HISTORY_DAYS - 30);
  const plans = [
    await insert('plans', { name: 'Monthly Basic', tax_id: gst, price: 999, billing_period: 'monthly', min_quantity: 1, start_date: yearAgo }),
    await insert('plans', { name: 'Monthly Team', tax_id: gst, price: 2499, billing_period: 'monthly', min_quantity: 5, start_date: yearAgo }),
    await insert('plans', { name: 'Annual Enterprise', tax_id: gst, price: 24999, billing_period: 'yearly', min_quantity: 10, start_date: yearAgo, pausable: false, closable: false }),
    await insert('plans', { name: 'Weekly Trial', tax_id: gst, price: 99, billing_period: 'weekly', min_quantity: 1, start_date: yearAgo, auto_close: true, renewable: false }),
  ];
  const minQty = { [plans[0]]: 1, [plans[1]]: 5, [plans[2]]: 10, [plans[3]]: 1 };

  const seats = await insert('discounts', { name: 'Bulk seats 10%', type: 'percentage', value: 10, scope: 'subscription', min_quantity: 10, start_date: yearAgo });
  const launch = await insert('discounts', { name: 'CRM launch 500 off', type: 'fixed', value: 500, scope: 'product', start_date: yearAgo, usage_limit: 300 });
  await query('INSERT INTO discount_products VALUES ($1, $2)', [launch, products[0]]);

  const template = await insert('quotation_templates', { name: 'Enterprise starter', plan_id: plans[2], validity_days: 30, notes: 'Standard enterprise bundle' });
  await query('INSERT INTO quotation_template_lines (template_id, product_id, quantity) VALUES ($1, $2, 10), ($1, $3, 10)', [template, products[0], products[4]]);

  const { rows: catalog } = await query('SELECT id, sales_price, tax_id FROM products ORDER BY id');
  const core = catalog.slice(0, 3);
  const addons = catalog.slice(3);
  const now = today();
  const subs = [];

  async function addSubscription({ customerId, planId, start, expiry, status = 'active', products, discount = null, validUntil = null }) {
    const billed = status === 'active';
    const id = await insert('subscriptions', {
      customer_id: customerId,
      plan_id: planId,
      status,
      start_date: start,
      expiry_date: expiry,
      next_invoice_date: billed ? start : null,
      discount_id: discount,
      valid_until: validUntil,
    });
    for (const product of products) {
      await query(
        'INSERT INTO subscription_lines (subscription_id, product_id, quantity, unit_price, tax_id) VALUES ($1, $2, $3, $4, $5)',
        [id, product.id, between(minQty[planId], minQty[planId] + 12), product.sales_price, product.tax_id],
      );
    }
    if (billed) subs.push({ id, expiry });
    return id;
  }

  const periodOf = { [plans[0]]: 'monthly', [plans[1]]: 'monthly', [plans[2]]: 'yearly' };
  function endAfter(start, planId, days) {
    let n = 1;
    while (addPeriod(start, periodOf[planId], n) <= addDays(start, days)) n += 1;
    return addDays(addPeriod(start, periodOf[planId], n), -1);
  }

  for (const [i, customerId] of customerIds.entries()) {
    const joined = i === 0 ? addDays(now, -420) : addDays(now, -Math.floor(HISTORY_DAYS * (1 - rand() ** 0.55)));
    const planId = i === 0 ? plans[1] : pick([plans[0], plans[0], plans[0], plans[1], plans[1], plans[1], plans[2]]);
    const lifetimeMonths = i === 0 ? Infinity : Math.floor(Math.log(1 - rand()) / Math.log(1 - MONTHLY_CHURN));
    const churnDay = Number.isFinite(lifetimeMonths) ? addDays(joined, Math.floor(lifetimeMonths * 30.4375)) : null;
    const churned = churnDay !== null && churnDay < now;
    const tenureDays = (Date.parse(churned ? churnDay : now) - Date.parse(joined)) / 86_400_000;

    await addSubscription({
      customerId,
      planId,
      start: joined,
      expiry: churned ? endAfter(joined, planId, tenureDays) : null,
      products: [...core].sort(() => rand() - 0.5).slice(0, between(1, 2)),
      discount: chance(0.1) ? pick([seats, launch]) : null,
    });

    if (tenureDays > 60 && chance(i === 0 ? 1 : 0.35)) {
      const addonStart = addDays(joined, between(30, Math.floor(tenureDays) - 15));
      const remaining = (Date.parse(churned ? churnDay : now) - Date.parse(addonStart)) / 86_400_000;
      const dropped = chance(0.3);
      await addSubscription({
        customerId,
        planId: plans[0],
        start: addonStart,
        expiry: churned || dropped ? endAfter(addonStart, plans[0], dropped ? remaining * rand() : remaining) : null,
        products: [pick(addons)],
      });
    }

    if (!churned && chance(0.08)) {
      const status = pick(['quotation', 'quotation', 'draft', 'confirmed']);
      await addSubscription({
        customerId,
        planId: pick([plans[1], plans[2]]),
        start: addDays(now, between(1, 20)),
        expiry: null,
        status,
        products: [pick(core), pick(addons)],
        validUntil: status === 'quotation' ? addDays(now, between(5, 25)) : null,
      });
    }
  }

  console.log(`Running billing for ${subs.length} subscriptions over ${HISTORY_DAYS} days...`);
  const billing = await runBilling();
  await query("UPDATE subscriptions SET status = 'closed' WHERE status = 'active' AND expiry_date < CURRENT_DATE");
  await query("UPDATE subscriptions SET status = 'paused' WHERE status = 'active' AND id % 29 = 0");

  await query("UPDATE invoices SET status = 'confirmed', issue_date = period_start, due_date = period_start + 15");
  await query(
    `WITH paid AS (
       SELECT id, total, issue_date, abs(hashtext(id::text)) AS h FROM invoices
        WHERE due_date < CURRENT_DATE - 3
          AND abs(hashtext(id::text || 'paid')) % 1000 >= CASE WHEN due_date < CURRENT_DATE - 60 THEN 3 ELSE 80 END
     )
     INSERT INTO payments (invoice_id, method, amount, paid_on, note)
     SELECT id, (ARRAY['bank_transfer','card','upi','cash','cheque'])[1 + h % 5]::payment_method,
            total, LEAST(issue_date + (h % 18)::int, CURRENT_DATE), 'Seeded payment'
       FROM paid`,
  );
  await query("UPDATE invoices i SET amount_paid = i.total, status = 'paid' FROM payments p WHERE p.invoice_id = i.id");

  const { rows: [counts] } = await query('SELECT (SELECT count(*) FROM subscriptions)::int AS subs, (SELECT count(*) FROM invoices)::int AS invoices');
  console.log(`Seeded ${CUSTOMERS} customers, ${counts.subs} subscriptions, ${counts.invoices} invoices (${billing.created} billed).`);
  console.log('Logins: admin@brightloop.io / Admin@1234, staff@brightloop.io / Staff@1234, customer@brightloop.io / Customer@1234');
}

seed().then(() => pool.end()).catch((err) => { console.error(err); process.exit(1); });

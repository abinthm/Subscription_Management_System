import { pool, query } from './pool.js';
import { migrate } from './migrate.js';
import { hashPassword } from '../lib/password.js';
import { addDays, today } from '../lib/dates.js';
import { runBilling } from '../modules/invoices/service.js';

const CUSTOMERS = Number(process.env.SEED_CUSTOMERS ?? 400);
const SUBSCRIPTIONS = Number(process.env.SEED_SUBSCRIPTIONS ?? 2500);

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const between = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

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

  const yearAgo = addDays(today(), -400);
  const plans = [
    await insert('plans', { name: 'Monthly Basic', price: 999, billing_period: 'monthly', min_quantity: 1, start_date: yearAgo }),
    await insert('plans', { name: 'Monthly Team', price: 2499, billing_period: 'monthly', min_quantity: 5, start_date: yearAgo }),
    await insert('plans', { name: 'Annual Enterprise', price: 24999, billing_period: 'yearly', min_quantity: 10, start_date: yearAgo, pausable: false, closable: false }),
    await insert('plans', { name: 'Weekly Trial', price: 99, billing_period: 'weekly', min_quantity: 1, start_date: yearAgo, auto_close: true, renewable: false }),
  ];
  const minQty = { [plans[0]]: 1, [plans[1]]: 5, [plans[2]]: 10, [plans[3]]: 1 };

  const seats = await insert('discounts', { name: 'Bulk seats 10%', type: 'percentage', value: 10, scope: 'subscription', min_quantity: 10, start_date: yearAgo });
  const launch = await insert('discounts', { name: 'CRM launch 500 off', type: 'fixed', value: 500, scope: 'product', start_date: yearAgo, usage_limit: 300 });
  await query('INSERT INTO discount_products VALUES ($1, $2)', [launch, products[0]]);

  const template = await insert('quotation_templates', { name: 'Enterprise starter', plan_id: plans[2], validity_days: 30, notes: 'Standard enterprise bundle' });
  await query('INSERT INTO quotation_template_lines (template_id, product_id, quantity) VALUES ($1, $2, 10), ($1, $3, 10)', [template, products[0], products[4]]);

  const { rows: catalog } = await query('SELECT id, sales_price, tax_id FROM products');
  const statuses = ['active', 'active', 'active', 'active', 'active', 'active', 'paused', 'closed', 'quotation', 'draft', 'confirmed'];
  for (let i = 0; i < SUBSCRIPTIONS; i += 1) {
    const planId = pick(plans.slice(0, 3).concat(plans[0], plans[1]));
    const status = pick(statuses);
    const start = addDays(today(), -between(0, 180));
    const subId = await insert('subscriptions', {
      customer_id: pick(customerIds),
      plan_id: planId,
      status,
      start_date: start,
      expiry_date: addDays(start, 365),
      next_invoice_date: status === 'active' || status === 'paused' ? start : null,
      discount_id: Math.random() < 0.15 ? pick([seats, launch]) : null,
      valid_until: status === 'quotation' ? addDays(today(), 20) : null,
    });
    const lineCount = between(1, 3);
    for (const product of [...catalog].sort(() => Math.random() - 0.5).slice(0, lineCount)) {
      await query(
        'INSERT INTO subscription_lines (subscription_id, product_id, quantity, unit_price, tax_id) VALUES ($1, $2, $3, $4, $5)',
        [subId, product.id, between(minQty[planId], minQty[planId] + 15), product.sales_price, product.tax_id],
      );
    }
  }

  console.log('Running billing for past periods...');
  await query(`UPDATE subscriptions SET status = 'active' WHERE status = 'paused'`);
  const pausedIds = (await query(`SELECT id FROM subscriptions WHERE next_invoice_date IS NOT NULL ORDER BY random() LIMIT $1`, [Math.floor(SUBSCRIPTIONS * 0.05)])).rows.map((r) => r.id);
  const billing = await runBilling();
  await query(`UPDATE subscriptions SET status = 'paused' WHERE id = ANY($1::bigint[])`, [pausedIds]);

  await query(`UPDATE invoices SET status = 'confirmed', issue_date = period_start, due_date = period_start + 15`);
  await query(
    `WITH paid AS (
       SELECT id, total, due_date FROM invoices
        WHERE due_date < CURRENT_DATE - 3 AND random() < 0.88
     )
     INSERT INTO payments (invoice_id, method, amount, paid_on, note)
     SELECT id, (ARRAY['bank_transfer','card','upi','cash','cheque'])[1 + floor(random() * 5)]::payment_method,
            total, LEAST(due_date - floor(random() * 10)::int, CURRENT_DATE), 'Seeded payment'
       FROM paid`,
  );
  await query(`UPDATE invoices i SET amount_paid = i.total, status = 'paid' FROM payments p WHERE p.invoice_id = i.id`);

  console.log(`Seeded ${CUSTOMERS} customers, ${SUBSCRIPTIONS} subscriptions, ${billing.created} invoices.`);
  console.log('Logins: admin@brightloop.io / Admin@1234, staff@brightloop.io / Staff@1234, customer@brightloop.io / Customer@1234');
}

seed().then(() => pool.end()).catch((err) => { console.error(err); process.exit(1); });

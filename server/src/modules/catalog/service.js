import { query, transaction } from '../../db/pool.js';
import { notFound } from '../../lib/errors.js';

export async function listTaxes() {
  return (await query('SELECT * FROM taxes ORDER BY active DESC, name')).rows;
}

export async function saveTax(id, { name, rate, active }) {
  const { rows } = id
    ? await query('UPDATE taxes SET name = $2, rate = $3, active = $4 WHERE id = $1 RETURNING *', [id, name, rate, active])
    : await query('INSERT INTO taxes (name, rate, active) VALUES ($1, $2, $3) RETURNING *', [name, rate, active]);
  if (!rows[0]) throw notFound('Tax');
  return rows[0];
}

const PRODUCT_SELECT = `
  SELECT p.*, t.name AS tax_name, t.rate AS tax_rate,
         COALESCE(json_agg(v ORDER BY v.attribute, v.value) FILTER (WHERE v.id IS NOT NULL), '[]') AS variants
    FROM products p
    LEFT JOIN taxes t ON t.id = p.tax_id
    LEFT JOIN product_variants v ON v.product_id = p.id`;

export async function listProducts({ q, includeInactive }) {
  const { rows } = await query(
    `${PRODUCT_SELECT}
     WHERE ($1::text IS NULL OR p.name ILIKE '%' || $1 || '%') AND ($2 OR p.active)
     GROUP BY p.id, t.id ORDER BY p.name`,
    [q, includeInactive],
  );
  return rows;
}

export async function getProduct(id, db = { query }) {
  const { rows } = await db.query(`${PRODUCT_SELECT} WHERE p.id = $1 GROUP BY p.id, t.id`, [id]);
  if (!rows[0]) throw notFound('Product');
  return rows[0];
}

export function saveProduct(id, { variants, ...p }) {
  return transaction(async (db) => {
    const values = [p.name, p.type, p.sales_price, p.cost_price, p.tax_id, p.notes, p.active];
    const { rows } = id
      ? await db.query(
          `UPDATE products SET name=$2, type=$3, sales_price=$4, cost_price=$5, tax_id=$6, notes=$7, active=$8
            WHERE id = $1 RETURNING id`,
          [id, ...values],
        )
      : await db.query(
          `INSERT INTO products (name, type, sales_price, cost_price, tax_id, notes, active)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
          values,
        );
    if (!rows[0]) throw notFound('Product');
    const productId = rows[0].id;

    const keep = variants.filter((v) => v.id).map((v) => v.id);
    await db.query('DELETE FROM product_variants WHERE product_id = $1 AND NOT (id = ANY($2::bigint[]))', [productId, keep]);
    for (const v of variants) {
      if (v.id) {
        await db.query(
          'UPDATE product_variants SET attribute=$3, value=$4, extra_price=$5 WHERE id=$1 AND product_id=$2',
          [v.id, productId, v.attribute, v.value, v.extra_price],
        );
      } else {
        await db.query(
          'INSERT INTO product_variants (product_id, attribute, value, extra_price) VALUES ($1,$2,$3,$4)',
          [productId, v.attribute, v.value, v.extra_price],
        );
      }
    }
    return getProduct(productId, db);
  });
}

export async function listPlans({ includeInactive }) {
  const { rows } = await query(
    `SELECT p.*, (SELECT count(*) FROM subscriptions s WHERE s.plan_id = p.id AND s.status = 'active')::int AS active_subscriptions
       FROM plans p WHERE $1 OR p.active ORDER BY p.name`,
    [includeInactive],
  );
  return rows;
}

export async function getPlan(id, db = { query }) {
  const { rows } = await db.query('SELECT * FROM plans WHERE id = $1', [id]);
  if (!rows[0]) throw notFound('Plan');
  return rows[0];
}

const PLAN_FIELDS = ['name', 'price', 'billing_period', 'min_quantity', 'start_date', 'end_date',
  'auto_close', 'closable', 'pausable', 'renewable', 'active'];

export async function savePlan(id, plan) {
  const values = PLAN_FIELDS.map((f) => plan[f]);
  const { rows } = id
    ? await query(
        `UPDATE plans SET ${PLAN_FIELDS.map((f, i) => `${f} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`,
        [id, ...values],
      )
    : await query(
        `INSERT INTO plans (${PLAN_FIELDS.join(', ')}) VALUES (${PLAN_FIELDS.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
        values,
      );
  if (!rows[0]) throw notFound('Plan');
  return rows[0];
}

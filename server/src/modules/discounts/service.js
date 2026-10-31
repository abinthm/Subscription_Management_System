import { query, transaction } from '../../db/pool.js';
import { notFound } from '../../lib/errors.js';

const SELECT = `
  SELECT d.*, COALESCE(array_agg(dp.product_id) FILTER (WHERE dp.product_id IS NOT NULL), '{}') AS product_ids,
         (d.active AND d.start_date <= CURRENT_DATE AND (d.end_date IS NULL OR d.end_date >= CURRENT_DATE)
           AND (d.usage_limit IS NULL OR d.used_count < d.usage_limit)) AS usable
    FROM discounts d LEFT JOIN discount_products dp ON dp.discount_id = d.id`;

export async function listDiscounts() {
  return (await query(`${SELECT} GROUP BY d.id ORDER BY d.active DESC, d.name`)).rows;
}

export async function getDiscount(id, db = { query }) {
  const { rows } = await db.query(`${SELECT} WHERE d.id = $1 GROUP BY d.id`, [id]);
  if (!rows[0]) throw notFound('Discount');
  return rows[0];
}

const FIELDS = ['name', 'type', 'value', 'scope', 'min_amount', 'min_quantity', 'start_date', 'end_date', 'usage_limit', 'active'];

export function saveDiscount(id, { product_ids, ...d }) {
  return transaction(async (db) => {
    const values = FIELDS.map((f) => d[f]);
    const { rows } = id
      ? await db.query(
          `UPDATE discounts SET ${FIELDS.map((f, i) => `${f} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING id`,
          [id, ...values],
        )
      : await db.query(
          `INSERT INTO discounts (${FIELDS.join(', ')}) VALUES (${FIELDS.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
          values,
        );
    if (!rows[0]) throw notFound('Discount');
    const discountId = rows[0].id;
    await db.query('DELETE FROM discount_products WHERE discount_id = $1', [discountId]);
    if (d.scope === 'product' && product_ids.length) {
      await db.query(
        'INSERT INTO discount_products (discount_id, product_id) SELECT $1, unnest($2::bigint[])',
        [discountId, product_ids],
      );
    }
    return getDiscount(discountId, db);
  });
}

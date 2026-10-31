import { query, transaction } from '../../db/pool.js';
import { notFound } from '../../lib/errors.js';

const SELECT = `
  SELECT t.*, p.name AS plan_name, p.billing_period,
         COALESCE(json_agg(json_build_object(
           'id', l.id, 'product_id', l.product_id, 'product_name', pr.name,
           'variant_id', l.variant_id, 'variant_label', v.attribute || ': ' || v.value,
           'quantity', l.quantity) ORDER BY l.id) FILTER (WHERE l.id IS NOT NULL), '[]') AS lines
    FROM quotation_templates t
    JOIN plans p ON p.id = t.plan_id
    LEFT JOIN quotation_template_lines l ON l.template_id = t.id
    LEFT JOIN products pr ON pr.id = l.product_id
    LEFT JOIN product_variants v ON v.id = l.variant_id`;

export async function listTemplates() {
  return (await query(`${SELECT} GROUP BY t.id, p.id ORDER BY t.name`)).rows;
}

export async function getTemplate(id, db = { query }) {
  const { rows } = await db.query(`${SELECT} WHERE t.id = $1 GROUP BY t.id, p.id`, [id]);
  if (!rows[0]) throw notFound('Quotation template');
  return rows[0];
}

export function saveTemplate(id, { lines, name, plan_id, validity_days, notes }) {
  return transaction(async (db) => {
    const { rows } = id
      ? await db.query(
          'UPDATE quotation_templates SET name=$2, plan_id=$3, validity_days=$4, notes=$5 WHERE id=$1 RETURNING id',
          [id, name, plan_id, validity_days, notes],
        )
      : await db.query(
          'INSERT INTO quotation_templates (name, plan_id, validity_days, notes) VALUES ($1,$2,$3,$4) RETURNING id',
          [name, plan_id, validity_days, notes],
        );
    if (!rows[0]) throw notFound('Quotation template');
    const templateId = rows[0].id;
    await db.query('DELETE FROM quotation_template_lines WHERE template_id = $1', [templateId]);
    for (const l of lines) {
      await db.query(
        'INSERT INTO quotation_template_lines (template_id, product_id, variant_id, quantity) VALUES ($1,$2,$3,$4)',
        [templateId, l.product_id, l.variant_id, l.quantity],
      );
    }
    return getTemplate(templateId, db);
  });
}

export async function deleteTemplate(id) {
  const { rowCount } = await query('DELETE FROM quotation_templates WHERE id = $1', [id]);
  if (!rowCount) throw notFound('Quotation template');
}

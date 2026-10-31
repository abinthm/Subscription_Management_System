import { query } from '../../db/pool.js';
import { notFound } from '../../lib/errors.js';

export async function listUsers({ role, q, limit, offset }) {
  const { rows } = await query(
    `SELECT id, email, name, role, phone, created_at,
            (SELECT count(*) FROM subscriptions s WHERE s.customer_id = u.id AND s.status = 'active')::int AS active_subscriptions,
            count(*) OVER() AS total_count
       FROM users u
      WHERE ($1::user_role IS NULL OR role = $1)
        AND ($2::text IS NULL OR name ILIKE '%' || $2 || '%' OR email ILIKE '%' || $2 || '%')
      ORDER BY created_at DESC
      LIMIT $3 OFFSET $4`,
    [role, q, limit, offset],
  );
  return rows;
}

export async function getUser(id) {
  const { rows } = await query('SELECT id, email, name, role, phone, address, created_at FROM users WHERE id = $1', [id]);
  if (!rows[0]) throw notFound('User');
  return rows[0];
}

export async function updateProfile(id, { name, phone, address }) {
  const { rows } = await query(
    `UPDATE users SET name = $2, phone = $3, address = $4 WHERE id = $1
     RETURNING id, email, name, role, phone, address, created_at`,
    [id, name, phone, address],
  );
  if (!rows[0]) throw notFound('User');
  return rows[0];
}

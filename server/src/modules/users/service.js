import { query, transaction } from '../../db/pool.js';
import { conflict, notFound } from '../../lib/errors.js';
import { keysetPage } from '../../db/paging.js';

export function listUsers({ role, q, limit, cursor }) {
  return keysetPage({
    select: `u.id, u.email, u.name, u.role, u.phone, u.active, u.created_at,
             (SELECT count(*) FROM subscriptions s WHERE s.customer_id = u.id AND s.status = 'active')::int AS active_subscriptions`,
    from: 'users u',
    where: `($1::user_role IS NULL OR u.role = $1)
            AND ($2::text IS NULL OR u.name ILIKE '%' || $2 || '%' OR u.email::text ILIKE '%' || $2 || '%')`,
    params: [role, q],
    keys: [{ col: 'u.id', field: 'id', type: 'bigint' }],
    cursor,
    limit,
  });
}

export async function getUser(id) {
  const { rows } = await query('SELECT id, email, name, role, phone, address, active, created_at FROM users WHERE id = $1', [id]);
  if (!rows[0]) throw notFound('User');
  return rows[0];
}

export async function updateProfile(id, { name, phone, address }) {
  const { rows } = await query(
    `UPDATE users SET name = $2, phone = $3, address = $4 WHERE id = $1
     RETURNING id, email, name, role, phone, address, active, created_at`,
    [id, name, phone, address],
  );
  if (!rows[0]) throw notFound('User');
  return rows[0];
}

export function setActive(id, active, actor) {
  if (id === actor.id && !active) throw conflict('You cannot deactivate your own account');
  return transaction(async (db) => {
    const { rows } = await db.query(
      'UPDATE users SET active = $2 WHERE id = $1 RETURNING id, email, name, role, phone, address, active, created_at',
      [id, active],
    );
    if (!rows[0]) throw notFound('User');
    if (!active) await db.query('DELETE FROM sessions WHERE user_id = $1', [id]);
    return rows[0];
  });
}

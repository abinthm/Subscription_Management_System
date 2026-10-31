const inrFormat = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });
export const inr = (n) => inrFormat.format(Number(n));

export function logActivity(db, { subscriptionId = null, invoiceId = null, actorId = null, action, message }) {
  return db.query(
    'INSERT INTO activities (subscription_id, invoice_id, actor_id, action, message) VALUES ($1, $2, $3, $4, $5)',
    [subscriptionId, invoiceId, actorId, action, message],
  );
}

const COLUMNS = { subscription: 'subscription_id', invoice: 'invoice_id' };

export async function activityFor(db, entity, id) {
  const { rows } = await db.query(
    `SELECT a.id, a.action, a.message, a.created_at, u.name AS actor, u.role AS actor_role
       FROM activities a LEFT JOIN users u ON u.id = a.actor_id
      WHERE a.${COLUMNS[entity]} = $1
      ORDER BY a.created_at DESC, a.id DESC LIMIT 100`,
    [id],
  );
  return rows;
}

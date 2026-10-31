import { query } from '../../db/pool.js';

const MONTHLY_FACTOR = `CASE p.billing_period
  WHEN 'daily' THEN 30.4375 WHEN 'weekly' THEN 4.348125 WHEN 'monthly' THEN 1 ELSE 1.0 / 12 END`;

export async function summary({ from, to }) {
  const [subs, money, overdue, trend, byPlan, recentOverdue] = await Promise.all([
    query(`SELECT status, count(*)::int AS count FROM subscriptions GROUP BY status`),
    query(
      `SELECT
         (SELECT COALESCE(sum(amount), 0) FROM payments WHERE paid_on BETWEEN $1 AND $2) AS revenue,
         (SELECT COALESCE(sum(total - amount_paid), 0) FROM invoices WHERE status = 'confirmed') AS outstanding,
         (SELECT COALESCE(sum(total), 0) FROM invoices WHERE status <> 'cancelled' AND issue_date BETWEEN $1 AND $2) AS invoiced,
         (SELECT count(*)::int FROM payments WHERE paid_on BETWEEN $1 AND $2) AS payment_count,
         (SELECT COALESCE(sum(l.quantity * l.unit_price * ${MONTHLY_FACTOR}), 0)
            FROM subscriptions s JOIN plans p ON p.id = s.plan_id JOIN subscription_lines l ON l.subscription_id = s.id
           WHERE s.status = 'active') AS mrr`,
      [from, to],
    ),
    query(
      `SELECT count(*)::int AS count, COALESCE(sum(total - amount_paid), 0) AS amount
         FROM invoices WHERE status = 'confirmed' AND due_date < CURRENT_DATE`,
    ),
    query(
      `SELECT to_char(m, 'YYYY-MM') AS month,
              COALESCE((SELECT sum(amount) FROM payments WHERE paid_on >= m AND paid_on < m + interval '1 month'), 0) AS revenue,
              COALESCE((SELECT sum(total) FROM invoices WHERE status <> 'cancelled' AND issue_date >= m AND issue_date < m + interval '1 month'), 0) AS invoiced
         FROM generate_series(date_trunc('month', CURRENT_DATE) - interval '5 months', date_trunc('month', CURRENT_DATE), interval '1 month') m
        ORDER BY m`,
    ),
    query(
      `SELECT p.name, count(s.id)::int AS active
         FROM plans p LEFT JOIN subscriptions s ON s.plan_id = p.id AND s.status = 'active'
        GROUP BY p.id ORDER BY active DESC, p.name LIMIT 6`,
    ),
    query(
      `SELECT i.id, i.number, u.name AS customer_name, i.due_date, i.total - i.amount_paid AS balance,
              CURRENT_DATE - i.due_date AS days_overdue
         FROM invoices i JOIN users u ON u.id = i.customer_id
        WHERE i.status = 'confirmed' AND i.due_date < CURRENT_DATE
        ORDER BY i.due_date LIMIT 8`,
    ),
  ]);

  const byStatus = Object.fromEntries(subs.rows.map((r) => [r.status, r.count]));
  return {
    range: { from, to },
    subscriptions: byStatus,
    active_subscriptions: byStatus.active ?? 0,
    ...money.rows[0],
    mrr: Math.round(money.rows[0].mrr * 100) / 100,
    overdue: overdue.rows[0],
    trend: trend.rows,
    by_plan: byPlan.rows,
    overdue_invoices: recentOverdue.rows,
  };
}

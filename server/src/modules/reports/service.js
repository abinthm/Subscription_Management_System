import { query } from '../../db/pool.js';

const MONTHLY_FACTOR = `CASE p.billing_period
  WHEN 'daily' THEN 30.4375 WHEN 'weekly' THEN 4.348125 WHEN 'monthly' THEN 1 ELSE 1.0 / 12 END`;

const ofPlan = (n) => `($${n}::bigint IS NULL OR subscription_id IN (SELECT id FROM subscriptions WHERE plan_id = $${n}))`;
const paymentOfPlan = (n) => `($${n}::bigint IS NULL OR invoice_id IN (SELECT id FROM invoices WHERE ${ofPlan(n)}))`;
const refundOfPlan = (n) => `($${n}::bigint IS NULL OR payment_id IN (SELECT id FROM payments WHERE ${paymentOfPlan(n)}))`;

export async function summary({ from, to, planId = null }) {
  const [subs, money, overdue, trend, byPlan, recentOverdue] = await Promise.all([
    query(`SELECT status, count(*)::int AS count FROM subscriptions WHERE ($1::bigint IS NULL OR plan_id = $1) GROUP BY status`, [planId]),
    query(
      `SELECT
         (SELECT COALESCE(sum(amount), 0) FROM payments WHERE paid_on BETWEEN $1 AND $2 AND ${paymentOfPlan(3)})
           - (SELECT COALESCE(sum(amount), 0) FROM refunds WHERE refunded_on BETWEEN $1 AND $2 AND ${refundOfPlan(3)}) AS revenue,
         (SELECT COALESCE(sum(total - amount_paid), 0) FROM invoices WHERE status = 'confirmed' AND ${ofPlan(3)}) AS outstanding,
         (SELECT COALESCE(sum(total), 0) FROM invoices WHERE status <> 'cancelled' AND issue_date BETWEEN $1 AND $2 AND ${ofPlan(3)}) AS invoiced,
         (SELECT count(*)::int FROM payments WHERE paid_on BETWEEN $1 AND $2 AND ${paymentOfPlan(3)}) AS payment_count,
         (SELECT COALESCE(sum((p.price + COALESCE(t.recurring, 0)) * ${MONTHLY_FACTOR}), 0)
            FROM subscriptions s
            JOIN plans p ON p.id = s.plan_id
            LEFT JOIN LATERAL (
              SELECT sum(l.quantity * l.unit_price) AS recurring FROM subscription_lines l WHERE l.subscription_id = s.id
            ) t ON true
           WHERE s.status = 'active' AND ($3::bigint IS NULL OR s.plan_id = $3)) AS mrr`,
      [from, to, planId],
    ),
    query(
      `SELECT count(*)::int AS count, COALESCE(sum(total - amount_paid), 0) AS amount
         FROM invoices WHERE status = 'confirmed' AND due_date < CURRENT_DATE AND ${ofPlan(1)}`,
      [planId],
    ),
    query(
      `SELECT to_char(m, 'YYYY-MM') AS month,
              COALESCE((SELECT sum(amount) FROM payments WHERE paid_on >= m AND paid_on < m + interval '1 month' AND ${paymentOfPlan(1)}), 0)
                - COALESCE((SELECT sum(amount) FROM refunds WHERE refunded_on >= m AND refunded_on < m + interval '1 month' AND ${refundOfPlan(1)}), 0) AS revenue,
              COALESCE((SELECT sum(total) FROM invoices WHERE status <> 'cancelled' AND issue_date >= m AND issue_date < m + interval '1 month' AND ${ofPlan(1)}), 0) AS invoiced
         FROM generate_series(date_trunc('month', CURRENT_DATE) - interval '5 months', date_trunc('month', CURRENT_DATE), interval '1 month') m
        ORDER BY m`,
      [planId],
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
        WHERE i.status = 'confirmed' AND i.due_date < CURRENT_DATE AND ${ofPlan(1)}
        ORDER BY i.due_date LIMIT 8`,
      [planId],
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

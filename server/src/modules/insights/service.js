import { query } from '../../db/pool.js';
import { holtForecast, projectMrr } from '../../lib/forecast.js';
import { MONTHLY_FACTOR } from '../reports/service.js';

const HISTORY_MONTHS = 24;
const FORECAST_MONTHS = 6;
const DRIVER_MONTHS = 3;

const SNAPSHOTS = `
  SELECT n AS idx,
         CASE WHEN n = $1 THEN CURRENT_DATE
              ELSE (date_trunc('month', CURRENT_DATE) - make_interval(months => $1 - n - 1) - interval '1 day')::date END AS d
    FROM generate_series(0, $1) n`;

const CUSTOMER_MRR = `
  SELECT s.idx, i.customer_id, sum((i.subtotal - i.discount_total) * ${MONTHLY_FACTOR}) AS mrr
    FROM snapshots s
    JOIN invoices i ON i.status <> 'cancelled' AND s.d BETWEEN i.period_start AND i.period_end
    JOIN subscriptions sub ON sub.id = i.subscription_id
    JOIN plans p ON p.id = sub.plan_id
   GROUP BY s.idx, i.customer_id`;

async function movements() {
  const { rows } = await query(
    `WITH snapshots AS (${SNAPSHOTS}),
          cm AS (${CUSTOMER_MRR}),
          series AS (
            SELECT s.idx, s.d, c.customer_id, COALESCE(cm.mrr, 0) AS mrr,
                   lag(COALESCE(cm.mrr, 0)) OVER (PARTITION BY c.customer_id ORDER BY s.idx) AS prev
              FROM snapshots s
             CROSS JOIN (SELECT DISTINCT customer_id FROM cm) c
              LEFT JOIN cm ON cm.idx = s.idx AND cm.customer_id = c.customer_id
          )
     SELECT idx, d AS date, to_char(d, 'YYYY-MM') AS month,
            round(sum(mrr), 2) AS mrr,
            round(sum(CASE WHEN prev = 0 AND mrr > 0 THEN mrr ELSE 0 END), 2) AS new,
            round(sum(CASE WHEN prev > 0 AND mrr > prev + 0.005 THEN mrr - prev ELSE 0 END), 2) AS expansion,
            round(sum(CASE WHEN prev > 0 AND mrr > 0 AND mrr < prev - 0.005 THEN prev - mrr ELSE 0 END), 2) AS contraction,
            round(sum(CASE WHEN prev > 0 AND mrr = 0 THEN prev ELSE 0 END), 2) AS churned,
            count(*) FILTER (WHERE mrr > 0)::int AS customers,
            count(*) FILTER (WHERE prev > 0)::int AS prev_customers,
            count(*) FILTER (WHERE prev > 0 AND mrr = 0)::int AS churned_customers
       FROM series GROUP BY idx, d ORDER BY idx`,
    [HISTORY_MONTHS],
  );
  return rows;
}

async function customerMrrNow() {
  const { rows } = await query(
    `WITH snapshots AS (${SNAPSHOTS}), cm AS (${CUSTOMER_MRR})
     SELECT customer_id,
            COALESCE(sum(mrr) FILTER (WHERE idx = $1), 0) AS mrr,
            COALESCE(sum(mrr) FILTER (WHERE idx = $1 - 1), 0) AS prev
       FROM cm WHERE idx >= $1 - 1 GROUP BY customer_id`,
    [HISTORY_MONTHS],
  );
  return new Map(rows.map((r) => [r.customer_id, r]));
}

async function unitEconomics() {
  const { rows } = await query(
    `SELECT
       (SELECT COALESCE(sum(l.quantity * l.unit_price), 0)
          FROM subscription_lines l JOIN subscriptions s ON s.id = l.subscription_id WHERE s.status = 'active') AS line_revenue,
       (SELECT COALESCE(sum(l.quantity * pr.cost_price), 0)
          FROM subscription_lines l JOIN subscriptions s ON s.id = l.subscription_id JOIN products pr ON pr.id = l.product_id
         WHERE s.status = 'active') AS line_cost,
       (SELECT COALESCE(sum(p.price), 0) FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.status = 'active') AS plan_revenue,
       (SELECT COALESCE(sum(total - amount_paid), 0) FROM invoices WHERE status = 'confirmed') AS receivables,
       (SELECT COALESCE(sum(total), 0) FROM invoices WHERE status <> 'cancelled' AND issue_date > CURRENT_DATE - 90) AS billed_90,
       (SELECT avg(p.paid_on - i.issue_date) FROM payments p JOIN invoices i ON i.id = p.invoice_id
         WHERE p.paid_on > CURRENT_DATE - 90) AS days_to_pay`,
  );
  return rows[0];
}

const RISK_RULES = [
  { key: 'overdue_30', points: 40, label: (r) => `Invoice ${r.days_overdue} days overdue`, when: (r) => r.days_overdue >= 30 },
  { key: 'overdue_14', points: 25, label: (r) => `Invoice ${r.days_overdue} days overdue`, when: (r) => r.days_overdue >= 14 && r.days_overdue < 30 },
  { key: 'overdue', points: 10, label: (r) => `Invoice ${r.days_overdue} days overdue`, when: (r) => r.days_overdue > 0 && r.days_overdue < 14 },
  { key: 'paused', points: 20, label: (r) => `${r.paused} paused subscription${r.paused > 1 ? 's' : ''}`, when: (r) => r.paused > 0 },
  { key: 'contraction', points: 15, label: () => 'Spend dropped since last month', when: (r) => r.prev > 0 && r.mrr < r.prev - 0.005 },
  { key: 'expiring', points: 15, label: () => 'Contract ends within 30 days', when: (r) => r.expiring > 0 },
  { key: 'refund', points: 10, label: () => 'Refund in the last 90 days', when: (r) => r.refunds > 0 },
];

async function revenueAtRisk(mrrByCustomer) {
  const { rows } = await query(
    `WITH subs AS (
       SELECT customer_id,
              count(*) FILTER (WHERE status = 'paused')::int AS paused,
              count(*) FILTER (WHERE status = 'active' AND expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30)::int AS expiring
         FROM subscriptions WHERE status IN ('active', 'paused') GROUP BY customer_id
     ),
     overdue AS (
       SELECT customer_id, max(CURRENT_DATE - due_date) AS days_overdue
         FROM invoices WHERE status = 'confirmed' AND due_date < CURRENT_DATE GROUP BY customer_id
     ),
     refunded AS (
       SELECT i.customer_id, count(*)::int AS refunds
         FROM refunds r JOIN payments p ON p.id = r.payment_id JOIN invoices i ON i.id = p.invoice_id
        WHERE r.refunded_on > CURRENT_DATE - 90 GROUP BY i.customer_id
     )
     SELECT u.id, u.name, COALESCE(o.days_overdue, 0) AS days_overdue, s.paused, s.expiring, COALESCE(r.refunds, 0) AS refunds
       FROM subs s
       JOIN users u ON u.id = s.customer_id AND u.active
       LEFT JOIN overdue o ON o.customer_id = s.customer_id
       LEFT JOIN refunded r ON r.customer_id = s.customer_id`,
  );

  return rows
    .map((r) => {
      const money = mrrByCustomer.get(r.id) ?? { mrr: 0, prev: 0 };
      const row = { ...r, mrr: Number(money.mrr), prev: Number(money.prev) };
      const hits = RISK_RULES.filter((rule) => rule.when(row));
      const score = hits.reduce((s, rule) => s + rule.points, 0);
      return {
        customer_id: r.id,
        name: r.name,
        mrr: Math.round(Math.max(row.mrr, row.prev) * 100) / 100,
        score,
        level: score >= 40 ? 'high' : score >= 20 ? 'medium' : 'low',
        reasons: hits.map((rule) => rule.label(row)),
      };
    })
    .filter((r) => r.score >= 20)
    .sort((a, b) => b.score - a.score || b.mrr - a.mrr);
}

const ratio = (a, b) => (b > 0 ? a / b : null);
const round = (n, dp = 2) => (n === null || !Number.isFinite(n) ? null : Math.round(n * 10 ** dp) / 10 ** dp);

export async function growthInsights() {
  const [series, mrrByCustomer, econ] = await Promise.all([movements(), customerMrrNow(), unitEconomics()]);
  const history = series.filter((m) => m.idx > 0);
  const now = history.at(-1);
  const lastMonth = history.at(-2);
  const recent = history.slice(0, -1).slice(-DRIVER_MONTHS);

  const sum = (key) => recent.reduce((s, m) => s + Number(m[key]), 0);
  const startMrr = recent.reduce((s, m) => s + Number(series[m.idx - 1].mrr), 0);
  const drivers = {
    mrr: Number(now.mrr),
    newMrr: recent.length ? sum('new') / recent.length : 0,
    expansionRate: ratio(sum('expansion'), startMrr) ?? 0,
    contractionRate: ratio(sum('contraction'), startMrr) ?? 0,
    churnRate: ratio(sum('churned'), startMrr) ?? 0,
  };

  const customerChurn = ratio(sum('churned_customers'), sum('prev_customers'));
  const arpa = ratio(drivers.mrr, now.customers);
  const revenue = Number(econ.line_revenue) + Number(econ.plan_revenue);
  const grossMargin = ratio(revenue - Number(econ.line_cost), revenue);
  const yearAgo = history.at(-13);
  const netRetentionMonthly = 1 + drivers.expansionRate - drivers.contractionRate - drivers.churnRate;

  const values = history.map((m) => Number(m.mrr));
  const firstRevenue = values.findIndex((v) => v > 0);
  const forecast = holtForecast(firstRevenue >= 0 ? values.slice(firstRevenue) : [], FORECAST_MONTHS);
  const lastDate = new Date(`${now.date}T00:00:00Z`);
  const futureMonth = (h) => new Date(Date.UTC(lastDate.getUTCFullYear(), lastDate.getUTCMonth() + h, 1)).toISOString().slice(0, 7);

  const atRisk = await revenueAtRisk(mrrByCustomer);

  return {
    as_of: now.date,
    months: history.map(({ idx, prev_customers, churned_customers, ...m }) => m),
    kpis: {
      mrr: drivers.mrr,
      arr: round(drivers.mrr * 12),
      mom_growth: round(ratio(drivers.mrr - Number(lastMonth.mrr), Number(lastMonth.mrr)), 4),
      yoy_growth: round(yearAgo && Number(yearAgo.mrr) ? ratio(drivers.mrr - Number(yearAgo.mrr), Number(yearAgo.mrr)) : null, 4),
      customers: now.customers,
      arpa: round(arpa),
      customer_churn: round(customerChurn, 4),
      revenue_churn: round(drivers.churnRate + drivers.contractionRate, 4),
      net_retention: round(netRetentionMonthly ** 12, 4),
      quick_ratio: round(ratio(sum('new') + sum('expansion'), sum('contraction') + sum('churned'))),
      gross_margin: round(grossMargin, 4),
      ltv: round(customerChurn && arpa && grossMargin !== null ? (arpa * grossMargin) / customerChurn : null),
      dso: round(ratio(Number(econ.receivables), Number(econ.billed_90)) * 90, 0),
      days_to_pay: round(econ.days_to_pay === null ? null : Number(econ.days_to_pay), 1),
    },
    drivers: Object.fromEntries(Object.entries(drivers).map(([k, v]) => [k, round(v, 6)])),
    baseline: projectMrr(drivers, 12).map((v) => round(v)),
    forecast: forecast && {
      method: 'Holt linear trend, damped',
      params: { alpha: forecast.alpha, beta: forecast.beta, phi: forecast.phi },
      typical_error: round(forecast.mape, 4),
      points: forecast.points.map((p, i) => ({ month: futureMonth(i + 1), value: round(p.value), low: round(p.low), high: round(p.high) })),
    },
    at_risk: {
      customers: atRisk.length,
      mrr: round(atRisk.reduce((s, r) => s + r.mrr, 0)),
      top: atRisk.slice(0, 12),
    },
  };
}

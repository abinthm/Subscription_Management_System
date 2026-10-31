const GRID = Array.from({ length: 19 }, (_, i) => (i + 1) / 20);
const DAMPING = [0.8, 0.85, 0.9, 0.95, 0.98, 1];

function fit(series, alpha, beta, phi) {
  let level = series[0];
  let trend = series[1] - series[0];
  let sse = 0;
  let ape = 0;
  for (let t = 1; t < series.length; t += 1) {
    const predicted = level + phi * trend;
    const error = series[t] - predicted;
    sse += error * error;
    if (series[t]) ape += Math.abs(error / series[t]);
    const prevLevel = level;
    level = alpha * series[t] + (1 - alpha) * predicted;
    trend = beta * (level - prevLevel) + (1 - beta) * phi * trend;
  }
  return { level, trend, sse, mape: ape / (series.length - 1) };
}

// Holt's linear trend with Gardner damping. Parameters come from an exhaustive grid search on
// one-step-ahead error, so the same history always produces the same forecast.
export function holtForecast(series, horizon) {
  if (series.length < 4) return null;
  let best = null;
  for (const alpha of GRID) {
    for (const beta of GRID) {
      for (const phi of DAMPING) {
        const f = fit(series, alpha, beta, phi);
        if (!best || f.sse < best.sse - 1e-9) best = { ...f, alpha, beta, phi };
      }
    }
  }

  const sigma = Math.sqrt(best.sse / (series.length - 1));
  const points = [];
  let damp = 0;
  for (let h = 1; h <= horizon; h += 1) {
    damp += best.phi ** h;
    const value = Math.max(best.level + damp * best.trend, 0);
    const spread = 1.2816 * sigma * Math.sqrt(h);
    points.push({ value, low: Math.max(value - spread, 0), high: value + spread });
  }
  return { alpha: best.alpha, beta: best.beta, phi: best.phi, mape: best.mape, points };
}

export function projectMrr({ mrr, newMrr, expansionRate, contractionRate, churnRate }, months) {
  const out = [];
  let current = mrr;
  for (let m = 0; m < months; m += 1) {
    current = Math.max(current * (1 + expansionRate - contractionRate - churnRate) + newMrr, 0);
    out.push(current);
  }
  return out;
}

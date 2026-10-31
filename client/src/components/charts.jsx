import { useState } from 'react';
import { moneyShort } from '../lib.js';

const W = 720;
const H = 240;
const PAD = { top: 16, right: 16, bottom: 28, left: 64 };
const plotW = W - PAD.left - PAD.right;
const plotH = H - PAD.top - PAD.bottom;

function niceTicks(min, max, count = 4) {
  const span = max - min || 1;
  const step = 10 ** Math.floor(Math.log10(span / count));
  const unit = [1, 2, 2.5, 5, 10].map((m) => m * step).find((s) => span / s <= count) ?? step * 10;
  const ticks = [];
  for (let v = Math.floor(min / unit) * unit; v <= max + unit / 2; v += unit) ticks.push(v);
  return ticks;
}

const monthLabel = (m) => {
  const [year, month] = m.split('-');
  const name = new Date(`${m}-01T00:00:00`).toLocaleString('en', { month: 'short' });
  return month === '01' ? `${name} ’${year.slice(2)}` : name;
};

function useHover(count, { bands = false, width = plotW } = {}) {
  const [index, setIndex] = useState(null);
  const onMove = (e) => {
    const box = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * W - PAD.left;
    const i = bands ? Math.floor((x / width) * count) : Math.round((x / width) * (count - 1));
    setIndex(Math.min(count - 1, Math.max(0, i)));
  };
  return { index, onMove, onLeave: () => setIndex(null) };
}

function Tooltip({ x, children }) {
  if (x === null) return null;
  const left = (x / W) * 100;
  return (
    <div className="chart-tip" style={{ left: `${left}%`, transform: `translateX(${left > 60 ? '-105%' : '5%'})` }}>
      {children}
    </div>
  );
}

function Axes({ ticks, y, labels, x }) {
  return (
    <>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="grid-line" />
          <text x={PAD.left - 8} y={y(t)} className="axis-label" textAnchor="end" dominantBaseline="middle">{moneyShort(t)}</text>
        </g>
      ))}
      {labels.map((l, i) => (labels.length <= 12 || i % 2 === 0) && (
        <text key={l} x={x(i)} y={H - 8} className="axis-label" textAnchor="middle">{monthLabel(l)}</text>
      ))}
    </>
  );
}

export function ForecastChart({ history, forecast, label }) {
  const points = [...history.map((h) => ({ month: h.month, actual: h.value })), ...forecast.map((f) => ({ month: f.month, ...f }))];
  const max = Math.max(...points.map((p) => p.high ?? p.actual ?? 0)) * 1.05;
  const ticks = niceTicks(0, max);
  const top = ticks.at(-1);
  const x = (i) => PAD.left + (i / (points.length - 1)) * plotW;
  const y = (v) => PAD.top + plotH - (v / top) * plotH;
  const hover = useHover(points.length);
  const split = history.length - 1;

  const actualPath = history.map((h, i) => `${i ? 'L' : 'M'}${x(i)},${y(h.value)}`).join('');
  const forecastPath = [`M${x(split)},${y(history[split].value)}`, ...forecast.map((f, i) => `L${x(split + i + 1)},${y(f.value)}`)].join('');
  const band = [
    `M${x(split)},${y(history[split].value)}`,
    ...forecast.map((f, i) => `L${x(split + i + 1)},${y(f.high)}`),
    ...forecast.map((f, i) => `L${x(split + forecast.length - i)},${y(forecast[forecast.length - 1 - i].low)}`),
    'Z',
  ].join('');
  const p = hover.index === null ? null : points[hover.index];

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} onMouseMove={hover.onMove} onMouseLeave={hover.onLeave}>
        <Axes ticks={ticks} y={y} labels={points.map((q) => q.month)} x={x} />
        <path d={band} className="forecast-band" />
        <path d={actualPath} className="line line-1" />
        <path d={forecastPath} className="line line-1 dashed" />
        {hover.index !== null && <line x1={x(hover.index)} x2={x(hover.index)} y1={PAD.top} y2={PAD.top + plotH} className="crosshair" />}
        {p && <circle cx={x(hover.index)} cy={y(p.actual ?? p.value)} r="4.5" className="dot-1" />}
      </svg>
      <Tooltip x={hover.index === null ? null : x(hover.index)}>
        {p && (
          <>
            <strong>{p.month}</strong>
            {p.actual !== undefined
              ? <div>MRR {moneyShort(p.actual)}</div>
              : <><div>Forecast {moneyShort(p.value)}</div><div className="muted">80% range {moneyShort(p.low)} – {moneyShort(p.high)}</div></>}
          </>
        )}
      </Tooltip>
    </div>
  );
}

export const MOVEMENTS = [
  { key: 'new', label: 'New', sign: 1, cls: 'mv-new' },
  { key: 'expansion', label: 'Expansion', sign: 1, cls: 'mv-exp' },
  { key: 'contraction', label: 'Contraction', sign: -1, cls: 'mv-con' },
  { key: 'churned', label: 'Churned', sign: -1, cls: 'mv-churn' },
];

export function MovementChart({ months, label }) {
  const up = months.map((m) => Number(m.new) + Number(m.expansion));
  const down = months.map((m) => Number(m.contraction) + Number(m.churned));
  const ticks = niceTicks(-Math.max(...down, 1), Math.max(...up, 1));
  const lo = ticks[0];
  const hi = ticks.at(-1);
  const slot = plotW / months.length;
  const x = (i) => PAD.left + slot * (i + 0.5);
  const y = (v) => PAD.top + ((hi - v) / (hi - lo)) * plotH;
  const barW = Math.min(28, slot * 0.6);
  const hover = useHover(months.length, { bands: true });
  const m = hover.index === null ? null : months[hover.index];

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} onMouseMove={hover.onMove} onMouseLeave={hover.onLeave}>
        <Axes ticks={ticks} y={y} labels={months.map((q) => q.month)} x={x} />
        <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} className="zero-line" />
        {months.map((mo, i) => {
          let pos = 0;
          let neg = 0;
          return (
            <g key={mo.month} className={hover.index === null || hover.index === i ? '' : 'faded'}>
              {MOVEMENTS.map((mv) => {
                const v = Number(mo[mv.key]);
                if (!v) return null;
                const from = mv.sign > 0 ? pos : neg;
                const to = from + mv.sign * v;
                if (mv.sign > 0) pos = to; else neg = to;
                const yTop = y(Math.max(from, to));
                const h = Math.max(Math.abs(y(from) - y(to)) - 2, 1);
                return <rect key={mv.key} x={x(i) - barW / 2} y={mv.sign > 0 ? yTop : yTop + 2} width={barW} height={h} rx="3" className={mv.cls} />;
              })}
            </g>
          );
        })}
      </svg>
      <Tooltip x={hover.index === null ? null : x(hover.index)}>
        {m && (
          <>
            <strong>{m.month}</strong>
            {MOVEMENTS.map((mv) => <div key={mv.key}><i className={`swatch ${mv.cls}`} />{mv.label} {mv.sign < 0 ? '−' : '+'}{moneyShort(m[mv.key])}</div>)}
            <div className="tip-total">Net {moneyShort(up[hover.index] - down[hover.index])}</div>
          </>
        )}
      </Tooltip>
    </div>
  );
}

export function ScenarioChart({ months, baseline, scenario, label }) {
  const max = Math.max(...baseline, ...scenario) * 1.05;
  const min = Math.min(...baseline, ...scenario) * 0.95;
  const ticks = niceTicks(min, max);
  const lo = ticks[0];
  const hi = ticks.at(-1);
  const labelRoom = 100;
  const width = plotW - labelRoom;
  const x = (i) => PAD.left + (i / (months.length - 1)) * width;
  const y = (v) => PAD.top + ((hi - v) / (hi - lo)) * plotH;
  const path = (series) => series.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join('');
  const hover = useHover(months.length, { width });
  const [scnY, baseY] = scenario.at(-1) >= baseline.at(-1)
    ? [Math.min(y(scenario.at(-1)), y(baseline.at(-1)) - 16), y(baseline.at(-1))]
    : [y(scenario.at(-1)), Math.min(y(baseline.at(-1)), y(scenario.at(-1)) - 16)];
  const i = hover.index;

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} onMouseMove={hover.onMove} onMouseLeave={hover.onLeave}>
        <Axes ticks={ticks} y={y} labels={months} x={x} />
        <path d={path(baseline)} className="line line-1" />
        <path d={path(scenario)} className="line line-2" />
        <text x={x(months.length - 1) + 8} y={scnY} className="direct-label" dominantBaseline="middle">Scenario</text>
        <text x={x(months.length - 1) + 8} y={baseY} className="direct-label" dominantBaseline="middle">Current trend</text>
        {i !== null && (
          <>
            <line x1={x(i)} x2={x(i)} y1={PAD.top} y2={PAD.top + plotH} className="crosshair" />
            <circle cx={x(i)} cy={y(baseline[i])} r="4.5" className="dot-1" />
            <circle cx={x(i)} cy={y(scenario[i])} r="4.5" className="dot-2" />
          </>
        )}
      </svg>
      <Tooltip x={i === null ? null : x(i)}>
        {i !== null && (
          <>
            <strong>{months[i]}</strong>
            <div><i className="swatch line-1-bg" />Current trend {moneyShort(baseline[i])}</div>
            <div><i className="swatch line-2-bg" />Scenario {moneyShort(scenario[i])}</div>
          </>
        )}
      </Tooltip>
    </div>
  );
}

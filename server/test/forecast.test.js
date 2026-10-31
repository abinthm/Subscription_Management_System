import { test } from 'node:test';
import assert from 'node:assert/strict';
import { holtForecast, projectMrr } from '../src/lib/forecast.js';

test('a steady linear trend is continued', () => {
  const f = holtForecast([100, 110, 120, 130, 140, 150, 160], 3);
  assert.deepEqual(f.points.map((p) => Math.round(p.value)), [170, 180, 190]);
  assert.ok(f.mape < 1e-9);
});

test('a flat series stays flat and the band widens with the horizon', () => {
  const f = holtForecast([500, 505, 495, 500, 503, 497, 500], 6);
  for (const p of f.points) assert.ok(Math.abs(p.value - 500) < 10);
  assert.ok(f.points[5].high - f.points[5].low > f.points[0].high - f.points[0].low);
});

test('same history gives the same forecast and short histories are refused', () => {
  const s = [10, 14, 13, 19, 22, 21, 27];
  assert.deepEqual(holtForecast(s, 4), holtForecast(s, 4));
  assert.equal(holtForecast([1, 2, 3], 2), null);
});

test('driver projection compounds retention and adds new revenue', () => {
  const p = projectMrr({ mrr: 1000, newMrr: 100, expansionRate: 0.02, contractionRate: 0.01, churnRate: 0.03 }, 2);
  assert.equal(Math.round(p[0]), 1080);
  assert.equal(Math.round(p[1] * 100) / 100, 1158.4);
});

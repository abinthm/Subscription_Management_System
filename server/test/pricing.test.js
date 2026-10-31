import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priceLines, isDiscountUsable, planFeeLine } from '../src/lib/pricing.js';
import { addPeriod } from '../src/lib/dates.js';

const lines = [
  { product_id: 1, quantity: 3, unit_price: 100, tax_rate: 18 },
  { product_id: 2, quantity: 1, unit_price: 50.5, tax_rate: 0 },
];

test('totals without discount', () => {
  const r = priceLines(lines);
  assert.equal(r.subtotal, 350.5);
  assert.equal(r.tax_total, 54);
  assert.equal(r.total, 404.5);
  assert.equal(r.discount_applied, false);
});

test('percentage subscription discount reduces taxable base', () => {
  const r = priceLines(lines, { scope: 'subscription', type: 'percentage', value: 10, min_amount: 0, min_quantity: 0, product_ids: [] });
  assert.equal(r.discount_total, 35.05);
  assert.equal(r.lines[0].amount, 270);
  assert.equal(r.tax_total, 48.6);
  assert.equal(r.total, 364.05);
});

test('product discount touches only listed products and respects min quantity', () => {
  const d = { scope: 'product', type: 'fixed', value: 30, min_amount: 0, min_quantity: 3, product_ids: [1] };
  const r = priceLines(lines, d);
  assert.equal(r.lines[0].discount_amount, 30);
  assert.equal(r.lines[1].discount_amount, 0);
  assert.equal(priceLines(lines, { ...d, min_quantity: 4 }).discount_applied, false);
});

test('fixed discount never exceeds the base', () => {
  const r = priceLines(lines, { scope: 'subscription', type: 'fixed', value: 10000, min_amount: 0, min_quantity: 0, product_ids: [] });
  assert.equal(r.subtotal - r.discount_total, 0);
  assert.equal(r.total, 0);
});

test('discount usability window and usage limit', () => {
  const d = { active: true, start_date: '2026-01-01', end_date: '2026-01-31', usage_limit: 2, used_count: 1 };
  assert.equal(isDiscountUsable(d, '2026-01-15'), true);
  assert.equal(isDiscountUsable(d, '2026-02-01'), false);
  assert.equal(isDiscountUsable({ ...d, used_count: 2 }, '2026-01-15'), false);
});

test('monthly periods clamp to month end without drifting', () => {
  assert.equal(addPeriod('2026-01-31', 'monthly', 1), '2026-02-28');
  assert.equal(addPeriod('2026-01-31', 'monthly', 2), '2026-03-31');
  assert.equal(addPeriod('2024-02-29', 'yearly', 1), '2025-02-28');
  assert.equal(addPeriod('2026-01-01', 'weekly', 2), '2026-01-15');
});

test('plan fee is billed as its own taxed line and skipped when free', () => {
  const [fee] = planFeeLine({ name: 'Team', price: 500 }, 18);
  assert.deepEqual(fee, { product_id: null, quantity: 1, unit_price: 500, tax_rate: 18, description: 'Team plan' });
  assert.deepEqual(planFeeLine({ name: 'Free', price: 0 }), []);
  assert.equal(priceLines([fee, ...lines]).total, 994.5);
});

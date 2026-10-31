import { Router } from 'express';
import { validate, str, int, id, money, bool, date, oneOf, list, paramId } from '../../lib/validate.js';
import { badRequest } from '../../lib/errors.js';
import { today } from '../../lib/dates.js';
import { requireTeam, requireAdmin } from '../../middleware/auth.js';
import { publish } from '../../lib/events.js';
import * as discounts from './service.js';

const router = Router();

const schema = {
  name: str({ max: 120 }),
  type: oneOf(['fixed', 'percentage']),
  value: money({ min: 0.01 }),
  scope: oneOf(['subscription', 'product'], { default: 'subscription' }),
  min_amount: money({ default: 0 }),
  min_quantity: int({ min: 0, max: 100000, default: 0 }),
  start_date: date({ default: today }),
  end_date: date({ optional: true }),
  usage_limit: int({ min: 1, max: 1_000_000, optional: true }),
  active: bool({ default: true }),
  product_ids: list(id(), { max: 500 }),
};

function validateDiscount(body) {
  const d = validate(schema, body);
  const errors = {};
  if (d.type === 'percentage' && d.value > 100) errors.value = 'A percentage cannot exceed 100';
  if (d.end_date && d.end_date < d.start_date) errors.end_date = 'Must be on or after the start date';
  if (d.scope === 'product' && !d.product_ids.length) errors.product_ids = 'Pick at least one product';
  if (Object.keys(errors).length) throw badRequest('Please fix the highlighted fields', errors);
  return d;
}

router.get('/', requireTeam, async (_req, res) => res.json(await discounts.listDiscounts()));

router.get('/:id', requireTeam, async (req, res) => res.json(await discounts.getDiscount(paramId(req))));

router.post('/', requireAdmin, async (req, res) => {
  const discount = await discounts.saveDiscount(null, validateDiscount(req.body));
  publish('discounts');
  res.status(201).json(discount);
});

router.put('/:id', requireAdmin, async (req, res) => {
  const discount = await discounts.saveDiscount(paramId(req), validateDiscount(req.body));
  publish('discounts');
  res.json(discount);
});

export default router;

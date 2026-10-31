import { Router } from 'express';
import { validate, str, int, id, money, bool, date, oneOf, list, paramId } from '../../lib/validate.js';
import { badRequest } from '../../lib/errors.js';
import { today } from '../../lib/dates.js';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';
import { publish } from '../../lib/events.js';
import * as catalog from './service.js';

const router = Router();
router.use(requireAuth);

const includeInactive = (req) => req.query.all === 'true' && req.user.role !== 'customer';

const taxSchema = {
  name: str({ max: 60 }),
  rate: money({ max: 100 }),
  active: bool({ default: true }),
};

const productSchema = {
  name: str({ max: 120 }),
  type: oneOf(['service', 'goods'], { default: 'service' }),
  sales_price: money(),
  cost_price: money({ default: 0 }),
  tax_id: id({ optional: true }),
  notes: str({ max: 2000, optional: true }),
  active: bool({ default: true }),
  variants: list({
    id: id({ optional: true }),
    attribute: str({ max: 60 }),
    value: str({ max: 60 }),
    extra_price: money({ default: 0 }),
  }),
};

const planSchema = {
  name: str({ max: 120 }),
  price: money(),
  billing_period: oneOf(['daily', 'weekly', 'monthly', 'yearly']),
  min_quantity: int({ min: 1, max: 100000, default: 1 }),
  start_date: date({ default: today }),
  end_date: date({ optional: true }),
  auto_close: bool({ default: false }),
  closable: bool({ default: true }),
  pausable: bool({ default: true }),
  renewable: bool({ default: true }),
  active: bool({ default: true }),
};

function validatePlan(body) {
  const plan = validate(planSchema, body);
  if (plan.end_date && plan.end_date < plan.start_date) {
    throw badRequest('Please fix the highlighted fields', { end_date: 'Must be on or after the start date' });
  }
  return plan;
}

router.get('/taxes', async (_req, res) => res.json(await catalog.listTaxes()));

router.post('/taxes', requireAdmin, async (req, res) => {
  const tax = await catalog.saveTax(null, validate(taxSchema, req.body));
  publish('taxes');
  res.status(201).json(tax);
});

router.put('/taxes/:id', requireAdmin, async (req, res) => {
  const tax = await catalog.saveTax(paramId(req), validate(taxSchema, req.body));
  publish('taxes');
  res.json(tax);
});

router.get('/products', async (req, res) => {
  const { q } = validate({ q: str({ max: 100, optional: true }) }, req.query);
  res.json(await catalog.listProducts({ q, includeInactive: includeInactive(req) }));
});

router.get('/products/:id', async (req, res) => res.json(await catalog.getProduct(paramId(req))));

router.post('/products', requireAdmin, async (req, res) => {
  const product = await catalog.saveProduct(null, validate(productSchema, req.body));
  publish('products');
  res.status(201).json(product);
});

router.put('/products/:id', requireAdmin, async (req, res) => {
  const product = await catalog.saveProduct(paramId(req), validate(productSchema, req.body));
  publish('products');
  res.json(product);
});

router.get('/plans', async (req, res) => res.json(await catalog.listPlans({ includeInactive: includeInactive(req) })));

router.get('/plans/:id', async (req, res) => res.json(await catalog.getPlan(paramId(req))));

router.post('/plans', requireAdmin, async (req, res) => {
  const plan = await catalog.savePlan(null, validatePlan(req.body));
  publish('plans');
  res.status(201).json(plan);
});

router.put('/plans/:id', requireAdmin, async (req, res) => {
  const plan = await catalog.savePlan(paramId(req), validatePlan(req.body));
  publish('plans');
  res.json(plan);
});

export default router;

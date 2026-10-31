import { Router } from 'express';
import { validate, str, int, id, date, oneOf, list, pageParams, pageOf, paramId } from '../../lib/validate.js';
import { badRequest } from '../../lib/errors.js';
import { today } from '../../lib/dates.js';
import { requireAuth, requireTeam } from '../../middleware/auth.js';
import { publish } from '../../lib/events.js';
import * as subs from './service.js';

const router = Router();
router.use(requireAuth);

const STATUSES = ['draft', 'quotation', 'confirmed', 'active', 'paused', 'closed'];

const schema = {
  customer_id: id(),
  plan_id: id(),
  discount_id: id({ optional: true }),
  start_date: date({ default: today }),
  expiry_date: date({ optional: true }),
  payment_terms_days: int({ min: 0, max: 180, default: 15 }),
  valid_until: date({ optional: true }),
  notes: str({ max: 2000, optional: true }),
  lines: list({ product_id: id(), variant_id: id({ optional: true }), quantity: int({ min: 1, max: 100000 }) }, { min: 1 }),
};

function validateSubscription(body) {
  const input = validate(schema, body);
  if (input.expiry_date && input.expiry_date < input.start_date) {
    throw badRequest('Please fix the highlighted fields', { expiry_date: 'Must be on or after the start date' });
  }
  return input;
}

const changed = (sub) => publish('subscriptions', { id: sub.id });

router.get('/', async (req, res) => {
  const filters = validate({
    status: oneOf(STATUSES, { optional: true }),
    plan_id: id({ optional: true }),
    customer_id: id({ optional: true }),
    q: str({ max: 100, optional: true }),
  }, req.query);
  const customerId = req.user.role === 'customer' ? req.user.id : filters.customer_id;
  const paging = pageParams(req.query);
  const rows = await subs.listSubscriptions({ ...filters, planId: filters.plan_id, customerId, ...paging });
  res.json(pageOf(rows, paging));
});

router.get('/:id', async (req, res) => res.json(await subs.getSubscription(paramId(req), req.user)));

router.post('/', requireTeam, async (req, res) => {
  const sub = await subs.createSubscription(validateSubscription(req.body), req.user);
  changed(sub);
  res.status(201).json(sub);
});

router.post('/from-template', requireTeam, async (req, res) => {
  const input = validate({ template_id: id(), customer_id: id(), start_date: date({ default: today }) }, req.body);
  const sub = await subs.createFromTemplate(input, req.user);
  changed(sub);
  res.status(201).json(sub);
});

router.put('/:id', requireTeam, async (req, res) => {
  const sub = await subs.updateSubscription(paramId(req), validateSubscription(req.body), req.user);
  changed(sub);
  res.json(sub);
});

router.post('/:id/:action', async (req, res) => {
  const { action } = validate({ action: oneOf(subs.ACTION_NAMES) }, req.params);
  const sub = await subs.runAction(paramId(req), action, req.user);
  changed(sub);
  res.json(sub);
});

export default router;

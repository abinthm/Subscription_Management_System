import { Router } from 'express';
import { validate, str, id, money, date, oneOf, pageParams, pageOf } from '../../lib/validate.js';
import { badRequest } from '../../lib/errors.js';
import { today } from '../../lib/dates.js';
import { requireAuth, requireTeam } from '../../middleware/auth.js';
import { publish } from '../../lib/events.js';
import * as payments from './service.js';

const router = Router();
router.use(requireAuth);

export const METHODS = ['cash', 'bank_transfer', 'card', 'upi', 'cheque'];

router.get('/', async (req, res) => {
  const filters = validate({
    method: oneOf(METHODS, { optional: true }),
    from: date({ optional: true }),
    to: date({ optional: true }),
    q: str({ max: 100, optional: true }),
  }, req.query);
  const customerId = req.user.role === 'customer' ? req.user.id : null;
  const paging = pageParams(req.query);
  res.json(pageOf(await payments.listPayments({ ...filters, customerId, ...paging }), paging));
});

router.post('/', requireTeam, async (req, res) => {
  const input = validate({
    invoice_id: id(),
    method: oneOf(METHODS),
    amount: money({ min: 0.01 }),
    paid_on: date({ default: today }),
    note: str({ max: 500, optional: true }),
  }, req.body);
  if (input.paid_on > today()) throw badRequest('Please fix the highlighted fields', { paid_on: 'Cannot be in the future' });
  const payment = await payments.recordPayment(input, req.user.id);
  publish('payments');
  publish('invoices', { id: input.invoice_id });
  publish('subscriptions', { id: payment.subscription_id });
  res.status(201).json(payment);
});

export default router;

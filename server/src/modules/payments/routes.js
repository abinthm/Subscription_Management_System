import { Router } from 'express';
import { config } from '../../config.js';
import { validate, str, id, money, date, oneOf, pageParams, paramId } from '../../lib/validate.js';
import { badRequest } from '../../lib/errors.js';
import { today } from '../../lib/dates.js';
import { requireAuth, requireTeam, requireAdmin } from '../../middleware/auth.js';
import { publish } from '../../lib/events.js';
import { idempotent } from '../../middleware/idempotency.js';
import { sendCsv, wantsCsv, CSV_LIMIT } from '../../lib/csv.js';
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
  const csv = wantsCsv(req);
  const paging = csv ? { limit: CSV_LIMIT, cursor: null, count: false } : pageParams(req.query);
  const page = await payments.listPayments({ ...filters, customerId, ...paging });
  if (!csv) return res.json(page);
  sendCsv(res, 'payments', [
    ['Date', 'paid_on'], ['Invoice', 'invoice_number'], ['Customer', 'customer_name'],
    ['Method', 'method'], ['Amount', 'amount'], ['Note', 'note'], ['Refunded on', 'refunded_on'],
  ], page.data);
});

router.post('/', requireTeam, idempotent, async (req, res) => {
  const input = validate({
    invoice_id: id(),
    method: oneOf(METHODS),
    amount: money({ min: 0.01 }),
    paid_on: date({ default: today }),
    note: str({ max: 500, optional: true }),
  }, req.body);
  if (input.paid_on > today()) throw badRequest('Please fix the highlighted fields', { paid_on: 'Cannot be in the future' });
  const payment = await payments.recordPayment(input, req.user.id);
  recorded(payment);
  res.status(201).json(payment);
});

router.get('/online/status', (_req, res) => res.json({ enabled: Boolean(config.razorpay) }));

router.post('/online/order', async (req, res) => {
  const { invoice_id } = validate({ invoice_id: id() }, req.body);
  res.status(201).json(await payments.startOnlinePayment(invoice_id, req.user));
});

router.post('/online/verify', async (req, res) => {
  const input = validate({
    order_id: str({ max: 64 }),
    payment_id: str({ max: 64 }),
    signature: str({ max: 128 }),
  }, req.body);
  const payment = await payments.completeOnlinePayment(input, req.user);
  if (!payment.duplicate) recorded(payment);
  res.status(201).json(payment);
});

router.post('/:id/refund', requireAdmin, idempotent, async (req, res) => {
  const { reason } = validate({ reason: str({ min: 3, max: 500 }) }, req.body);
  const refund = await payments.refundPayment(paramId(req), reason, req.user.id);
  publish('payments');
  publish('invoices', { id: refund.invoice_id });
  publish('subscriptions', { id: refund.subscription_id });
  res.status(201).json(refund);
});

function recorded(payment) {
  publish('payments');
  publish('invoices', { id: payment.invoice_id });
  publish('subscriptions', { id: payment.subscription_id });
}

export default router;

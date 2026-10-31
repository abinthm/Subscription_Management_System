import { Router } from 'express';
import { validate, str, id, date, oneOf, bool, pageParams, paramId } from '../../lib/validate.js';
import { requireAuth, requireTeam } from '../../middleware/auth.js';
import { publish } from '../../lib/events.js';
import { idempotent } from '../../middleware/idempotency.js';
import { sendCsv, wantsCsv, CSV_LIMIT } from '../../lib/csv.js';
import * as invoices from './service.js';

const router = Router();
router.use(requireAuth);

const changed = (invoice) => {
  publish('invoices', { id: invoice.id });
  publish('subscriptions', { id: invoice.subscription_id });
};

router.get('/', async (req, res) => {
  const filters = validate({
    status: oneOf(['draft', 'confirmed', 'paid', 'cancelled'], { optional: true }),
    overdue: bool({ default: false }),
    customer_id: id({ optional: true }),
    q: str({ max: 100, optional: true }),
    from: date({ optional: true }),
    to: date({ optional: true }),
  }, req.query);
  const customerId = req.user.role === 'customer' ? req.user.id : filters.customer_id;
  const csv = wantsCsv(req);
  const paging = csv ? { limit: CSV_LIMIT, cursor: null, count: false } : pageParams(req.query);
  const page = await invoices.listInvoices({ ...filters, customerId, ...paging });
  if (!csv) return res.json(page);
  sendCsv(res, 'invoices', [
    ['Number', 'number'], ['Customer', 'customer_name'], ['Subscription', 'subscription_number'], ['Status', 'status'],
    ['Overdue', 'is_overdue'], ['Issued', 'issue_date'], ['Due', 'due_date'], ['Period start', 'period_start'],
    ['Period end', 'period_end'], ['Total', 'total'], ['Paid', 'amount_paid'], ['Balance', 'balance'],
  ], page.data);
});

router.get('/:id', async (req, res) => res.json(await invoices.getInvoice(paramId(req), req.user)));

router.post('/billing-run', requireTeam, async (_req, res) => {
  const result = await invoices.runBilling();
  if (result.created) publish('invoices');
  res.json(result);
});

router.post('/from-subscription/:id', requireTeam, idempotent, async (req, res) => {
  const invoice = await invoices.invoiceNow(paramId(req), req.user);
  changed(invoice);
  res.status(201).json(invoice);
});

router.post('/:id/send', requireTeam, async (req, res) => {
  const invoice = await invoices.sendInvoice(paramId(req), req.user);
  changed(invoice);
  res.json(invoice);
});

router.post('/:id/:action', requireTeam, async (req, res) => {
  const { action } = validate({ action: oneOf(['confirm', 'cancel']) }, req.params);
  const invoice = await invoices.changeStatus(paramId(req), action, req.user);
  changed(invoice);
  res.json(invoice);
});

export default router;

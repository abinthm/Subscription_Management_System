import { Router } from 'express';
import { validate, date, id } from '../../lib/validate.js';
import { badRequest } from '../../lib/errors.js';
import { addDays, today } from '../../lib/dates.js';
import { requireTeam } from '../../middleware/auth.js';
import * as reports from './service.js';

const router = Router();

router.get('/summary', requireTeam, async (req, res) => {
  const range = validate({
    from: date({ default: () => addDays(today(), -30) }),
    to: date({ default: today }),
    plan_id: id({ optional: true }),
  }, req.query);
  if (range.from > range.to) throw badRequest('Please fix the highlighted fields', { from: 'Must be before the end date' });
  res.json(await reports.summary({ ...range, planId: range.plan_id }));
});

export default router;

import { Router } from 'express';
import { validate, str, int, id, list, paramId } from '../../lib/validate.js';
import { requireTeam } from '../../middleware/auth.js';
import { publish } from '../../lib/events.js';
import * as templates from './service.js';

const router = Router();
router.use(requireTeam);

const schema = {
  name: str({ max: 120 }),
  plan_id: id(),
  validity_days: int({ min: 1, max: 365, default: 30 }),
  notes: str({ max: 2000, optional: true }),
  lines: list({ product_id: id(), variant_id: id({ optional: true }), quantity: int({ min: 1, max: 100000 }) }, { min: 1 }),
};

router.get('/', async (_req, res) => res.json(await templates.listTemplates()));

router.get('/:id', async (req, res) => res.json(await templates.getTemplate(paramId(req))));

router.post('/', async (req, res) => {
  const template = await templates.saveTemplate(null, validate(schema, req.body));
  publish('templates');
  res.status(201).json(template);
});

router.put('/:id', async (req, res) => {
  const template = await templates.saveTemplate(paramId(req), validate(schema, req.body));
  publish('templates');
  res.json(template);
});

router.delete('/:id', async (req, res) => {
  await templates.deleteTemplate(paramId(req));
  publish('templates');
  res.status(204).end();
});

export default router;

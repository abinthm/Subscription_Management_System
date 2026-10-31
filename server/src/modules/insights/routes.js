import { Router } from 'express';
import { requireTeam } from '../../middleware/auth.js';
import { growthInsights } from './service.js';

const router = Router();

router.get('/growth', requireTeam, async (_req, res) => res.json(await growthInsights()));

export default router;

import { Router } from 'express';
import { validate, str, email, password, oneOf, bool, pageParams, paramId } from '../../lib/validate.js';
import { forbidden } from '../../lib/errors.js';
import { requireAuth, requireTeam, requireAdmin } from '../../middleware/auth.js';
import { publish } from '../../lib/events.js';
import { createUser } from '../auth/service.js';
import * as users from './service.js';

const router = Router();
const ROLES = ['admin', 'staff', 'customer'];

const profileSchema = {
  name: str({ max: 120 }),
  phone: str({ max: 30, optional: true }),
  address: str({ max: 300, optional: true }),
};

function assertCanManage(actor, targetRole) {
  if (actor.role !== 'admin' && targetRole !== 'customer') {
    throw forbidden('Only an admin can manage staff accounts');
  }
}

router.put('/me', requireAuth, async (req, res) => {
  res.json(await users.updateProfile(req.user.id, validate(profileSchema, req.body)));
});

router.get('/', requireTeam, async (req, res) => {
  const { role, q } = validate({ role: oneOf(ROLES, { optional: true }), q: str({ max: 100, optional: true }) }, req.query);
  const effectiveRole = req.user.role === 'admin' ? role : 'customer';
  res.json(await users.listUsers({ role: effectiveRole, q, ...pageParams(req.query) }));
});

router.post('/', requireTeam, async (req, res) => {
  const input = validate(
    { ...profileSchema, email: email(), password: password(), role: oneOf(ROLES, { default: 'customer' }) },
    req.body,
  );
  assertCanManage(req.user, input.role);
  const user = await createUser(input);
  publish('users');
  res.status(201).json(user);
});

router.get('/:id', requireTeam, async (req, res) => {
  const user = await users.getUser(paramId(req));
  assertCanManage(req.user, user.role);
  res.json(user);
});

router.put('/:id', requireTeam, async (req, res) => {
  const target = await users.getUser(paramId(req));
  assertCanManage(req.user, target.role);
  const user = await users.updateProfile(target.id, validate(profileSchema, req.body));
  publish('users');
  res.json(user);
});

router.put('/:id/active', requireAdmin, async (req, res) => {
  const { active } = validate({ active: bool() }, req.body);
  const user = await users.setActive(paramId(req), active, req.user);
  publish('users');
  res.json(user);
});

export default router;

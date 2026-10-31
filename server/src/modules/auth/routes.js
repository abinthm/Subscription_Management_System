import { Router } from 'express';
import { config } from '../../config.js';
import { validate, str, email, password } from '../../lib/validate.js';
import { requireAuth, SESSION_COOKIE } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import * as auth from './service.js';

const router = Router();
const limiter = rateLimit({ windowMs: 15 * 60_000, max: 20 });

function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies,
    maxAge: config.sessionDays * 86_400_000,
  });
}

router.post('/signup', limiter, async (req, res) => {
  const input = validate({ name: str({ max: 120 }), email: email(), password: password() }, req.body);
  const user = await auth.createUser(input);
  setSessionCookie(res, await auth.startSession(user.id));
  res.status(201).json(user);
});

router.post('/login', limiter, async (req, res) => {
  const input = validate({ email: email(), password: str({ max: 128 }) }, req.body);
  const { token, user } = await auth.login(input.email, input.password);
  setSessionCookie(res, token);
  res.json(user);
});

router.post('/logout', async (req, res) => {
  if (req.sessionToken) await auth.endSession(req.sessionToken);
  res.clearCookie(SESSION_COOKIE);
  res.status(204).end();
});

router.get('/me', async (req, res) => {
  res.json(req.user ? await auth.findUser(req.user.id) : null);
});

router.post('/change-password', requireAuth, limiter, async (req, res) => {
  const input = validate({ current_password: str({ max: 128 }), new_password: password() }, req.body);
  await auth.changePassword(req.user.id, req.sessionToken, input.current_password, input.new_password);
  res.json({ message: 'Password changed. Other devices have been signed out.' });
});

router.post('/forgot-password', limiter, async (req, res) => {
  const input = validate({ email: email() }, req.body);
  await auth.requestPasswordReset(input.email);
  res.json({ message: 'If that email is registered, a reset link is on its way.' });
});

router.post('/reset-password', limiter, async (req, res) => {
  const input = validate({ token: str({ max: 200 }), password: password() }, req.body);
  await auth.resetPassword(input.token, input.password);
  res.json({ message: 'Password updated. Please sign in.' });
});

export default router;

import { query } from '../db/pool.js';
import { hashToken } from '../lib/password.js';
import { unauthorized, forbidden } from '../lib/errors.js';

export const SESSION_COOKIE = 'sid';

function readCookie(req, name) {
  const header = req.headers.cookie ?? '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export async function authenticate(req, _res, next) {
  req.user = null;
  const token = readCookie(req, SESSION_COOKIE);
  if (token) {
    const { rows } = await query(
      `SELECT u.id, u.email, u.name, u.role
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active`,
      [hashToken(token)],
    );
    req.user = rows[0] ?? null;
    req.sessionToken = token;
  }
  next();
}

export const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) throw unauthorized();
  if (roles.length && !roles.includes(req.user.role)) throw forbidden();
  next();
};

export const requireAuth = requireRole();
export const requireTeam = requireRole('admin', 'staff');
export const requireAdmin = requireRole('admin');

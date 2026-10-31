import { query } from '../db/pool.js';
import { AppError } from '../lib/errors.js';

export function rateLimit({ windowMs, max }) {
  return async (req, _res, next) => {
    const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
    const { rows } = await query(
      `INSERT INTO rate_limits (key, window_start) VALUES ($1, $2)
       ON CONFLICT (key, window_start) DO UPDATE SET hits = rate_limits.hits + 1
       RETURNING hits`,
      [`${req.ip}:${req.path}`, windowStart],
    );
    if (rows[0].hits > max) throw new AppError(429, 'Too many attempts, please try again shortly');
    next();
  };
}

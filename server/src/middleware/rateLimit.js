import { AppError } from '../lib/errors.js';

// NOTE: in-memory per-process buckets; move to Postgres/Redis when running more than one instance
export function rateLimit({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => hits.clear(), windowMs).unref();
  return (req, _res, next) => {
    const key = `${req.ip}:${req.path}`;
    const count = (hits.get(key) ?? 0) + 1;
    hits.set(key, count);
    if (count > max) throw new AppError(429, 'Too many attempts, please try again shortly');
    next();
  };
}

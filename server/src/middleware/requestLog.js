import { randomUUID } from 'node:crypto';
import { config } from '../config.js';

const QUIET = new Set(['/api/events', '/api/health', '/api/ready']);

export function requestLog(req, res, next) {
  const incoming = req.get('x-request-id');
  req.id = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  res.set('X-Request-Id', req.id);
  if (!config.logRequests || QUIET.has(req.path)) return next();

  const started = process.hrtime.bigint();
  res.on('finish', () => {
    console.log(JSON.stringify({
      at: new Date().toISOString(),
      id: req.id,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      ms: Number(process.hrtime.bigint() - started) / 1e6,
      user: req.user?.id ?? null,
    }));
  });
  next();
}

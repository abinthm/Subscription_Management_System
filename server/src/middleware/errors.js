import { AppError } from '../lib/errors.js';

const PG_ERRORS = {
  23505: [409, 'That value is already in use'],
  23503: [409, 'This record is linked to other records'],
  23514: [400, 'A value is outside the allowed range'],
  '22P02': [400, 'Invalid value supplied'],
  22003: [400, 'A number is too large'],
};

export function notFoundHandler(req, _res, next) {
  next(new AppError(404, `No route for ${req.method} ${req.path}`));
}

export function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body is not valid JSON' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large' });
  }
  const pg = PG_ERRORS[err.code];
  if (pg) {
    const message = err.code === '23505' && err.constraint === 'users_email_key'
      ? 'An account with this email already exists'
      : pg[1];
    return res.status(pg[0]).json({ error: message });
  }
  console.error(`[${req.id}] ${req.method} ${req.path}`, err);
  res.status(500).json({ error: 'Something went wrong on our side. Please try again.', request_id: req.id });
}

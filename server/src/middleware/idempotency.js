import { query } from '../db/pool.js';
import { badRequest, conflict } from '../lib/errors.js';

// Replays the stored response when a client retries a request with the same Idempotency-Key,
// so a double-click or a network retry can never record the same payment twice.
export async function idempotent(req, res, next) {
  const key = req.get('idempotency-key');
  if (!key) return next();
  if (!/^[\w-]{8,100}$/.test(key)) throw badRequest('Invalid Idempotency-Key header');
  const path = `${req.method} ${req.baseUrl}${req.path}`;

  const { rowCount } = await query(
    'INSERT INTO idempotency_keys (user_id, key, request_path) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
    [req.user.id, key, path],
  );
  if (!rowCount) {
    const { rows } = await query('SELECT request_path, status, response FROM idempotency_keys WHERE user_id = $1 AND key = $2', [req.user.id, key]);
    const prior = rows[0];
    if (prior.request_path !== path) throw conflict('This Idempotency-Key was already used for a different request');
    if (prior.status === null) throw conflict('The original request is still being processed');
    res.set('Idempotent-Replayed', 'true');
    return res.status(prior.status).json(prior.response);
  }

  const json = res.json.bind(res);
  res.json = (body) => {
    const settle = res.statusCode < 400
      ? query('UPDATE idempotency_keys SET status = $3, response = $4 WHERE user_id = $1 AND key = $2', [req.user.id, key, res.statusCode, body])
      : query('DELETE FROM idempotency_keys WHERE user_id = $1 AND key = $2', [req.user.id, key]);
    settle.catch((err) => console.error('[idempotency]', err.message));
    return json(body);
  };
  next();
}

import { query, transaction } from '../../db/pool.js';
import { config } from '../../config.js';
import { hashPassword, verifyPassword, newToken, hashToken } from '../../lib/password.js';
import { sendMail } from '../../lib/mailer.js';
import { badRequest, unauthorized } from '../../lib/errors.js';

const RESET_TTL_MINUTES = 30;
const PUBLIC_FIELDS = 'id, email, name, role, phone, address, created_at';

export async function createUser({ name, email, password, role = 'customer', phone = null, address = null }) {
  const { rows } = await query(
    `INSERT INTO users (name, email, password_hash, role, phone, address)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${PUBLIC_FIELDS}`,
    [name, email, await hashPassword(password), role, phone, address],
  );
  return rows[0];
}

export async function login(email, password) {
  const { rows } = await query('SELECT id, password_hash FROM users WHERE email = $1', [email]);
  const ok = rows[0] && (await verifyPassword(password, rows[0].password_hash));
  if (!ok) throw unauthorized('Incorrect email or password');
  return { token: await startSession(rows[0].id), user: await findUser(rows[0].id) };
}

export async function startSession(userId) {
  const token = newToken();
  await query(
    `INSERT INTO sessions (token_hash, user_id, expires_at)
     VALUES ($1, $2, now() + make_interval(days => $3))`,
    [hashToken(token), userId, config.sessionDays],
  );
  await query('DELETE FROM sessions WHERE user_id = $1 AND expires_at < now()', [userId]);
  return token;
}

export const endSession = (token) => query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);

export async function findUser(id) {
  const { rows } = await query(`SELECT ${PUBLIC_FIELDS} FROM users WHERE id = $1`, [id]);
  return rows[0];
}

export async function requestPasswordReset(email) {
  const { rows } = await query('SELECT id, name FROM users WHERE email = $1', [email]);
  if (!rows[0]) return;

  const token = newToken();
  await query(
    `INSERT INTO password_resets (token_hash, user_id, expires_at)
     VALUES ($1, $2, now() + make_interval(mins => $3))`,
    [hashToken(token), rows[0].id, RESET_TTL_MINUTES],
  );
  const link = `${config.appUrl}/reset-password?token=${token}`;
  await sendMail({
    to: email,
    subject: 'Reset your Brightloop password',
    text: `Hi ${rows[0].name},\n\nReset your password using this link (valid for ${RESET_TTL_MINUTES} minutes):\n${link}\n\nIf you did not ask for this, you can ignore this email.`,
  });
}

export async function resetPassword(token, password) {
  await transaction(async (db) => {
    const { rows } = await db.query(
      `UPDATE password_resets SET used_at = now()
        WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
        RETURNING user_id`,
      [hashToken(token)],
    );
    if (!rows[0]) throw badRequest('This reset link is invalid or has expired');
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await hashPassword(password), rows[0].user_id]);
    await db.query('DELETE FROM sessions WHERE user_id = $1', [rows[0].user_id]);
  });
}

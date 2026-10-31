import { query, transaction } from '../../db/pool.js';
import { config } from '../../config.js';
import { hashPassword, verifyPassword, newToken, hashToken } from '../../lib/password.js';
import { sendMail, htmlEmail } from '../../lib/mailer.js';
import { badRequest, forbidden, unauthorized } from '../../lib/errors.js';

const RESET_TTL_MINUTES = 30;
const PUBLIC_FIELDS = 'id, email, name, role, phone, address, active, created_at';
// Unknown emails still pay for a hash check so response time does not reveal which accounts exist.
const dummyHash = hashPassword(newToken());

export async function createUser({ name, email, password, role = 'customer', phone = null, address = null }) {
  const { rows } = await query(
    `INSERT INTO users (name, email, password_hash, role, phone, address)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${PUBLIC_FIELDS}`,
    [name, email, await hashPassword(password), role, phone, address],
  );
  return rows[0];
}

export async function login(email, password) {
  const { rows } = await query('SELECT id, password_hash, active FROM users WHERE email = $1', [email]);
  const user = rows[0];
  const ok = await verifyPassword(password, user?.password_hash ?? await dummyHash);
  if (!user || !ok) throw unauthorized('Incorrect email or password');
  if (!user.active) throw forbidden('This account has been deactivated. Please contact support.');
  return { token: await startSession(user.id), user: await findUser(user.id) };
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
  const { rows } = await query('SELECT id, name FROM users WHERE email = $1 AND active', [email]);
  if (!rows[0]) return;

  const token = newToken();
  const link = `${config.appUrl}/reset-password?token=${token}`;
  await transaction(async (db) => {
    await db.query(
      `INSERT INTO password_resets (token_hash, user_id, expires_at)
       VALUES ($1, $2, now() + make_interval(mins => $3))`,
      [hashToken(token), rows[0].id, RESET_TTL_MINUTES],
    );
    await sendMail({
    to: email,
    subject: 'Reset your Brightloop password',
    text: `Hi ${rows[0].name},\n\nReset your password using this link (valid for ${RESET_TTL_MINUTES} minutes):\n${link}\n\nIf you did not ask for this, you can ignore this email.`,
    html: htmlEmail({
      heading: 'Reset your password',
      paragraphs: [`Hi ${rows[0].name},`, `Use the button below to choose a new password. The link is valid for ${RESET_TTL_MINUTES} minutes and works once.`, 'If you did not ask for this, you can ignore this email.'],
      action: { label: 'Reset password', url: link },
    }),
    }, db);
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

export async function changePassword(userId, keepToken, current, next) {
  const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [userId]);
  if (!rows[0] || !(await verifyPassword(current, rows[0].password_hash))) {
    throw badRequest('Please fix the highlighted fields', { current_password: 'Current password is incorrect' });
  }
  await transaction(async (db) => {
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await hashPassword(next), userId]);
    await db.query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [userId, hashToken(keepToken)]);
  });
}

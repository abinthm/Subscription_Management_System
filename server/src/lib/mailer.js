import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { pool, query } from '../db/pool.js';

const transport = nodemailer.createTransport(config.smtp ?? { jsonTransport: true });
const MAX_ATTEMPTS = 8;

async function deliver({ to, subject, text, html }) {
  if (!to) throw new Error('Email has no recipient');
  const info = await transport.sendMail({ from: config.mailFrom, to, subject, text, html });
  if (!config.smtp) console.log(`[mail] to=${to} subject="${subject}"\n${text}`);
  return info;
}

// Emails go through an outbox row written in the caller's transaction: a rolled-back change never
// emails anyone, and a committed one is delivered even if the process dies or SMTP is down.
export async function sendMail(message, db = { query }) {
  await db.query("INSERT INTO outbox (kind, payload) VALUES ('email', $1)", [message]);
  kickOutbox();
}

let kick = null;
export function kickOutbox() {
  if (kick) return;
  kick = setTimeout(() => {
    kick = null;
    if (!pool.ending) drainOutbox().catch((err) => console.error('[outbox] drain failed:', err.message));
  }, 200);
  kick.unref();
}

export async function drainOutbox(batch = 20) {
  let sent = 0;
  for (;;) {
    const { rows } = await query(
      `UPDATE outbox SET attempts = attempts + 1,
              available_at = now() + make_interval(secs => LEAST(3600, 30 * power(2, attempts)))
        WHERE id IN (SELECT id FROM outbox
                      WHERE sent_at IS NULL AND available_at <= now() AND attempts < $2
                      ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED)
        RETURNING id, payload`,
      [batch, MAX_ATTEMPTS],
    );
    if (!rows.length) return sent;
    for (const row of rows) {
      try {
        await deliver(row.payload);
        await query('UPDATE outbox SET sent_at = now(), last_error = NULL WHERE id = $1', [row.id]);
        sent += 1;
      } catch (err) {
        console.error(`[outbox] email ${row.id} failed:`, err.message);
        await query('UPDATE outbox SET last_error = $2 WHERE id = $1', [row.id, err.message.slice(0, 500)]);
      }
    }
  }
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function htmlEmail({ heading, paragraphs = [], rows = [], action }) {
  const table = rows.length
    ? `<table style="width:100%;border-collapse:collapse;margin:16px 0">${rows.map(([k, v, strong]) => `<tr>`
      + `<td style="padding:6px 0;border-bottom:1px solid #eee;color:${strong ? '#111' : '#555'}">${strong ? `<b>${esc(k)}</b>` : esc(k)}</td>`
      + `<td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right">${strong ? `<b>${esc(v)}</b>` : esc(v)}</td></tr>`).join('')}</table>`
    : '';
  const button = action
    ? `<p style="margin:24px 0"><a href="${esc(action.url)}" style="background:#111;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">${esc(action.label)}</a></p>`
    : '';
  return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:560px;margin:0 auto;padding:24px">`
    + `<h2 style="margin:0 0 16px;font-size:20px">${esc(heading)}</h2>`
    + paragraphs.map((p) => `<p style="margin:0 0 12px;line-height:1.5">${esc(p)}</p>`).join('')
    + table + button
    + `<p style="margin:24px 0 0;color:#888;font-size:12px">Brightloop Software</p></div>`;
}

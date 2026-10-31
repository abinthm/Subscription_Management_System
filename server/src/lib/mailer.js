import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { AppError } from './errors.js';

const transport = nodemailer.createTransport(config.smtp ?? { jsonTransport: true });

export async function sendMail({ to, subject, text, html }) {
  let info;
  try {
    info = await transport.sendMail({ from: config.mailFrom, to, subject, text, html });
  } catch (err) {
    console.error(`[mail] to=${to} subject="${subject}" failed:`, err.message);
    throw new AppError(502, 'The email could not be sent. Please try again later.');
  }
  if (!config.smtp) console.log(`[mail] to=${to} subject="${subject}"\n${text}`);
  return info;
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

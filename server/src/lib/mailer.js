import nodemailer from 'nodemailer';
import { config } from '../config.js';

const transport = nodemailer.createTransport(config.smtp ?? { jsonTransport: true });

export async function sendMail({ to, subject, text, html }) {
  const info = await transport.sendMail({ from: config.mailFrom, to, subject, text, html });
  if (!config.smtp) console.log(`[mail] to=${to} subject="${subject}"\n${text}`);
  return info;
}

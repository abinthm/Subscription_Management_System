const env = process.env;

export const config = {
  port: Number(env.PORT ?? 4000),
  databaseUrl: env.DATABASE_URL ?? 'postgres://localhost:5432/subscriptions',
  appUrl: env.APP_URL ?? 'http://localhost:5173',
  sessionDays: Number(env.SESSION_DAYS ?? 7),
  secureCookies: (env.APP_URL ?? '').startsWith('https://'),
  smtp: env.SMTP_HOST
    ? {
        host: env.SMTP_HOST,
        port: Number(env.SMTP_PORT ?? 587),
        auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
      }
    : null,
  mailFrom: env.MAIL_FROM ?? 'Brightloop Billing <billing@brightloop.local>',
  razorpay: env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET
    ? { keyId: env.RAZORPAY_KEY_ID, keySecret: env.RAZORPAY_KEY_SECRET }
    : null,
};

import express from 'express';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { authenticate, requireAuth } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { requestLog } from './middleware/requestLog.js';
import { query } from './db/pool.js';
import { subscribe } from './lib/events.js';
import authRoutes from './modules/auth/routes.js';
import userRoutes from './modules/users/routes.js';
import catalogRoutes from './modules/catalog/routes.js';
import discountRoutes from './modules/discounts/routes.js';
import templateRoutes from './modules/templates/routes.js';
import subscriptionRoutes from './modules/subscriptions/routes.js';
import invoiceRoutes from './modules/invoices/routes.js';
import paymentRoutes from './modules/payments/routes.js';
import reportRoutes from './modules/reports/routes.js';
import insightRoutes from './modules/insights/routes.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use((_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
    });
    next();
  });
  app.use(requestLog);
  app.use(express.json({ limit: '100kb' }));
  app.use(authenticate);

  const api = express.Router();
  api.get('/health', (_req, res) => res.json({ ok: true }));
  api.get('/ready', async (_req, res) => {
    try {
      await Promise.race([query('SELECT 1'), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))]);
      res.json({ ok: true, database: 'up' });
    } catch {
      res.status(503).json({ ok: false, database: 'down' });
    }
  });
  api.get('/events', requireAuth, (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();
    res.write('retry: 3000\n\n');
    subscribe(res);
  });
  api.use('/auth', authRoutes);
  api.use('/users', userRoutes);
  api.use('/catalog', catalogRoutes);
  api.use('/discounts', discountRoutes);
  api.use('/templates', templateRoutes);
  api.use('/subscriptions', subscriptionRoutes);
  api.use('/invoices', invoiceRoutes);
  api.use('/payments', paymentRoutes);
  api.use('/reports', reportRoutes);
  api.use('/insights', insightRoutes);
  api.use(notFoundHandler);
  app.use('/api', api);

  const clientDist = fileURLToPath(new URL('../../client/dist', import.meta.url));
  if (existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get('/{*path}', (_req, res) => res.sendFile('index.html', { root: clientDist }));
  }

  app.use(errorHandler);
  return app;
}

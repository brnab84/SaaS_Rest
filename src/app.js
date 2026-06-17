import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import { logger } from './utils/logger.js';
import { errorHandler } from './middleware/validate.js';
import authRoutes from './routes/auth.js';
import orderRoutes from './routes/orders.js';
import webhookRoutes from './routes/webhooks.js';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(pinoHttp({ logger }));

  // rawBody para validar firmas de webhooks
  app.use(express.json({
    verify: (req, _res, buf) => { req.rawBody = buf; },
  }));

  const apiLimiter = rateLimit({ windowMs: 60_000, max: 120 });
  const authLimiter = rateLimit({ windowMs: 60_000, max: 10 });

  app.get('/health', (_req, res) => res.json({ ok: true }));

  app.use('/api/auth', authLimiter, authRoutes);
  app.use('/api/orders', apiLimiter, orderRoutes);
  app.use('/webhooks', webhookRoutes); // sin limiter: MP/Meta reintentan

  // Landing pública estática (servida por slug) — Claude Code: implementar render por tenant
  app.use(express.static('public'));

  app.use(errorHandler);
  return app;
}

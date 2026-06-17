import express from 'express';
import path from 'node:path';
import helmet from 'helmet';
import cors from 'cors';
import pkg from '../package.json' with { type: 'json' };
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import { logger } from './utils/logger.js';
import { errorHandler } from './middleware/validate.js';
import authRoutes from './routes/auth.js';
import orderRoutes from './routes/orders.js';
import productRoutes from './routes/products.js';
import expenseRoutes from './routes/expenses.js';
import campaignRoutes from './routes/campaigns.js';
import dashboardRoutes from './routes/dashboard.js';
import publicRoutes from './routes/public.js';
import webhookRoutes from './routes/webhooks.js';

export function createApp() {
  const app = express();

  // CSP a medida: permite estilos inline + Google Fonts (PWA y landing), scripts solo self.
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        upgradeInsecureRequests: null, // no forzar https (rompe dev local)
      },
    },
  }));
  app.use(cors());
  app.use(pinoHttp({ logger }));

  // rawBody para validar firmas de webhooks
  app.use(express.json({
    verify: (req, _res, buf) => { req.rawBody = buf; },
  }));

  const apiLimiter = rateLimit({ windowMs: 60_000, max: 120 });
  const authLimiter = rateLimit({ windowMs: 60_000, max: 10 });

  app.get('/health', (_req, res) => res.json({ ok: true }));

  // Versión: semver de package.json + commit de git (Railway lo inyecta en el deploy).
  app.get('/api/version', (_req, res) => res.json({
    name: pkg.name,
    version: pkg.version,
    commit: (process.env.RAILWAY_GIT_COMMIT_SHA || '').slice(0, 7) || 'dev',
  }));

  app.use('/api/auth', authLimiter, authRoutes);
  app.use('/api/orders', apiLimiter, orderRoutes);
  app.use('/api/products', apiLimiter, productRoutes);
  app.use('/api/expenses', apiLimiter, expenseRoutes);
  app.use('/api/campaigns', apiLimiter, campaignRoutes);
  app.use('/api/dashboard', apiLimiter, dashboardRoutes);
  app.use('/api/public', apiLimiter, publicRoutes); // landing pública, sin auth
  app.use('/webhooks', webhookRoutes); // sin limiter: MP/Meta reintentan

  // Storefront público por slug: una misma SPA para /r/:slug; el cliente JS resuelve el slug.
  app.get('/r/:slug', (_req, res) => res.sendFile(path.join(process.cwd(), 'public', 'store', 'index.html')));

  // Estáticos: panel (/app), storefront (/store), landing y assets.
  app.use(express.static('public'));

  app.use(errorHandler);
  return app;
}

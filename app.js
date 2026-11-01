import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import session from 'express-session';
import { config } from './config/index.js';
import { MySQLSessionStore } from './services/sessionStore.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';
import { requireAuth, csrfProtection, apiLimiter } from './middleware/security.js';
import authRoutes from './routes/auth.js';
import tasksRoutes from './routes/tasks.js';
import remindersRoutes from './routes/reminders.js';
import { memories, projects } from './routes/records.js';
import { conversations, attachments } from './routes/conversations.js';
import { profile, dashboard, security, approvals, integrationsRouter } from './routes/account.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApp({ store = new MySQLSessionStore() } = {}) {
  const app = express();
  app.disable('x-powered-by');
  if (config.isProd) app.set('trust proxy', 1); // behind an HTTPS reverse proxy

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https://lh3.googleusercontent.com'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'", 'https://accounts.google.com'],
      },
    },
  }));

  app.use(session({
    name: 'light.sid',
    secret: config.sessionSecret,
    store,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: config.sessionTtlMs },
  }));

  app.use(express.json({ limit: '100kb' }));

  app.get('/healthz', (req, res) => res.json({ ok: true }));
  app.use('/auth', authRoutes);

  // Everything under /api needs a valid session, a CSRF token on writes, and is rate limited.
  const api = express.Router();
  api.use(apiLimiter, requireAuth, csrfProtection);
  api.use('/', profile);
  api.use('/', dashboard);
  api.use('/conversations', conversations);
  api.use('/attachments', attachments);
  api.use('/tasks', tasksRoutes);
  api.use('/reminders', remindersRoutes);
  api.use('/memories', memories);
  api.use('/projects', projects);
  api.use('/integrations', integrationsRouter);
  api.use('/security', security);
  api.use('/approvals', approvals);
  app.use('/api', api);
  app.use('/api', notFound);

  app.use(express.static(path.join(here, 'public'), { index: 'index.html', maxAge: config.isProd ? '1h' : 0 }));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

import express from 'express';
import { createAuthGuards } from './middleware/auth.js';
import { createAuthThrottle, createPasswordWorkLimit } from './middleware/auth-throttle.js';
import { createAdminRouter } from './routes/admin.js';
import { createAuthRouter } from './routes/auth.js';

export function createApp({ db, jwt, trustProxyHops = 0, rateLimits, authHashConcurrency = 8 }) {
  if (!jwt) throw new Error('JWT configuration is required');
  const app = express();
  const guards = createAuthGuards(db, jwt);
  const throttle = createAuthThrottle(rateLimits);
  const passwordWorkLimit = createPasswordWorkLimit(authHashConcurrency);
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxyHops);
  app.use(express.json({ limit: '16kb' }));
  app.use('/auth/register', throttle.registration, passwordWorkLimit);
  app.use('/auth/login', throttle.loginIp, throttle.loginAccount, passwordWorkLimit);
  app.use('/auth', createAuthRouter(db, jwt, guards));
  app.use('/admin', createAdminRouter(db, guards));

  app.get('/health', (_req, res) => {
    try {
      db.prepare('SELECT id FROM users LIMIT 0').all();
      db.prepare('SELECT id FROM refresh_sessions LIMIT 0').all();
      res.json({ status: 'ok', database: 'ok' });
    } catch {
      res.status(503).json({ status: 'unavailable', database: 'unavailable' });
    }
  });

  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use((error, _req, res, _next) => {
    if (error instanceof SyntaxError && 'body' in error) return res.status(400).json({ error: 'Invalid JSON' });
    if (error.status === 413) return res.status(413).json({ error: 'Request body too large' });
    console.error(error);
    return res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}

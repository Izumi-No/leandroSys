import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { env } from './env';
import type { AppEnv } from './lib/auth';
import { errorResponse } from './lib/errors';
import { authRoutes } from './modules/auth/routes';
import { catalogRoutes } from './modules/catalog/routes';
import { comandaRoutes } from './modules/comandas/routes';
import { printRoutes } from './modules/printers/routes';
import { tableRoutes } from './modules/tables/routes';

export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use(
    '*',
    cors({
      origin: env.corsOrigin,
      allowHeaders: ['Content-Type', 'Authorization'],
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    }),
  );

  app.notFound((c) => c.json({ error: 'Rota não encontrada', code: 'NOT_FOUND' }, 404));

  app.onError((err, c) => {
    const { status, body } = errorResponse(err);
    return c.json(body, status);
  });

  app.get('/api/health', (c) =>
    c.json({ ok: true, service: 'leandroSys', time: new Date().toISOString() }),
  );

  app.route('/api/auth', authRoutes);
  app.route('/api', catalogRoutes);
  app.route('/api', tableRoutes);
  app.route('/api', comandaRoutes);
  app.route('/api', printRoutes);

  return app;
}

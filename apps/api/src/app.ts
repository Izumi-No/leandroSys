import { Hono } from 'hono';
import { authController } from '../adapters/http/authController';
import { catalogController } from '../adapters/http/catalogController';
import { comandaController } from '../adapters/http/comandaController';
import { printerController } from '../adapters/http/printerController';
import { tableController } from '../adapters/http/tableController';
import { env } from '../env';
import { cors } from 'hono/cors';
import { errorResponse } from '../lib/errors';
import type { AppEnv } from '../lib/auth';

export function createApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', cors({ origin: env.corsOrigin, allowHeaders: ['Content-Type', 'Authorization'], allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] }));
  app.notFound((c) => c.json({ error: 'Rota não encontrada', code: 'NOT_FOUND' }, 404));
  app.onError((err, c) => {
    const { status, body } = errorResponse(err);
    return c.json(body, status);
  });
  app.get('/api/health', (c) => c.json({ ok: true, service: 'leandroSys', time: new Date().toISOString() }));
  app.route('/api/auth', authController);
  app.route('/api/catalog', catalogController);
  app.route('/api/comandas', comandaController);
  app.route('/api/printers', printerController);
  app.route('/api/tables', tableController);
  return app;
}

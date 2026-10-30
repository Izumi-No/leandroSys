import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../lib/auth';
import { createDatabase } from './index';

export const databaseMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  if (c.req.method === 'OPTIONS' || c.req.path === '/api/health') return next();

  const { db, close } = createDatabase(c.env?.DATABASE_URL);
  c.set('db', db);

  try {
    await next();
  } finally {
    await close();
  }
});

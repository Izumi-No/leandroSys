import { serve } from '@hono/node-server';
import { createApp } from './app';
import { env } from './env';
import { db } from './prisma/db';

const app = createApp();

const server = serve({ fetch: app.fetch, port: env.port }, (info) => {
  console.log(`leandroSys API em http://localhost:${info.port}/api`);
});

const shutdown = async (signal: string): Promise<void> => {
  console.log(`\nEncerrando (${signal})...`);
  server.close();
  await db.close();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

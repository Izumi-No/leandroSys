import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { env } from './env';

const app = createApp();

export default { fetch: app.fetch };

// Só sobe o servidor HTTP de Node quando executado diretamente (`pnpm dev`).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = serve({ fetch: app.fetch, port: env.port }, (info) => {
    console.log(`leandroSys API em http://localhost:${info.port}/api`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\nEncerrando (${signal})...`);
    server.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

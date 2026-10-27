import { createApp } from './app';

// Entrada do Cloudflare Workers (deploy via `wrangler deploy`).
const app = createApp();

export default {
  fetch: app.fetch,
};

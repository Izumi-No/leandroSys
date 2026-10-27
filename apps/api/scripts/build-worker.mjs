import { build } from 'esbuild';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

await build({
  entryPoints: [join(root, 'src/worker.ts')],
  outfile: join(root, 'dist/worker.js'),
  format: 'esm',
  platform: 'browser',
  bundle: true,
  sourcemap: true,
  external: ['@prisma/orm-postgres', 'pg', 'pg-pool'],
  target: 'es2022',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info',
});

console.log('Worker bundle written to dist/worker.js');
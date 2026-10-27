import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(app, 'dist');

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, 'renderer'), { recursive: true });

const comum = { bundle: true, sourcemap: true, logLevel: 'info' };

// Processo principal e preload rodam no Node do Electron.
await build({
  ...comum,
  entryPoints: [path.join(app, 'src/main.ts')],
  outfile: path.join(dist, 'main.js'),
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
});

await build({
  ...comum,
  entryPoints: [path.join(app, 'src/preload.ts')],
  outfile: path.join(dist, 'preload.js'),
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
});

// Renderer: processo de navegador (sem Node; só fala com o main via preload).
await build({
  ...comum,
  entryPoints: [path.join(app, 'renderer/renderer.ts')],
  outfile: path.join(dist, 'renderer/renderer.js'),
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
});

await cp(path.join(app, 'renderer/index.html'), path.join(dist, 'renderer/index.html'));
await cp(path.join(app, 'renderer/styles.css'), path.join(dist, 'renderer/styles.css'));

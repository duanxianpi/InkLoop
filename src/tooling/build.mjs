import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { build as buildWeb } from 'vite';

const root = new URL('../../', import.meta.url);
const path = (relative) => fileURLToPath(new URL(relative, root));

// Vite emits one SPA entry with ordinary hashed JS/CSS assets. No SSR or script inlining.
await buildWeb({ configFile: path('vite.config.ts'), logLevel: 'warn' });

// Integration tests run this bundle. Deployment lets Wrangler bundle the same Worker source.
await build({
  entryPoints: [path('src/server/index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  external: ['cloudflare:*', 'node:*'],
  outfile: path('dist/worker.js'),
});

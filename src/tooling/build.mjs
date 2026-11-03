import { cp, mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { build as buildWeb } from 'vite';

const root = new URL('../../', import.meta.url);
const path = (relative) => fileURLToPath(new URL(relative, root));

// Vite emits one SPA entry with ordinary hashed JS/CSS assets. No SSR or script inlining.
await buildWeb({ configFile: path('vite.config.ts'), logLevel: 'warn' });

// Pinned drawing assets are served locally; no font/icon CDN exception is needed in CSP.
const manifest = JSON.parse(await readFile(path('package.json'), 'utf8'));
const assetManifest = JSON.parse(
  await readFile(path('node_modules/@tldraw/assets/package.json'), 'utf8'),
);
if (assetManifest.version !== manifest.dependencies.tldraw)
  throw new Error('tldraw engine/assets versions differ');
const assetDestination = path(`dist/public/assets/tldraw/${assetManifest.version}/`);
await mkdir(assetDestination, { recursive: true });
for (const name of ['fonts', 'icons', 'translations', 'embed-icons', 'LICENSE.md']) {
  await cp(path('node_modules/@tldraw/assets/' + name), assetDestination + name, {
    recursive: true,
  });
}

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

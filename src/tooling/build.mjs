import { cp, mkdir, readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { build as buildWeb } from 'vite';
import { generateToolList } from './mcp-tools.mjs';

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

// The service worker is served from the site root. It lists this build's files, so its own bytes
// (and with them its version) change whenever the shell or anything it loads changes.
const files = (await readdir(path('dist/public/assets'), { recursive: true, withFileTypes: true }))
  .filter((entry) => entry.isFile())
  .map((entry) => '/' + relative(path('dist/public'), join(entry.parentPath, entry.name)));
const tldraw = `/assets/tldraw/${assetManifest.version}/`;
// What the board loads to open: Vite's scripts, styles and woff2 fonts, and tldraw's fonts, embed
// icons, icon sprite and English strings. Account-page images and other languages load on demand.
const opensBoard = (file) =>
  file.startsWith(tldraw)
    ? /^(fonts|embed-icons)\/|^icons\/icon\/0_merged\.svg$|^translations\/en\.json$/.test(
        file.slice(tldraw.length),
      )
    : /^\/assets\/[^/]+\.(js|css|woff2)$/.test(file);
await build({
  entryPoints: [path('src/sw/sw.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  define: {
    BUILD_FILES: JSON.stringify(files.sort()),
    PRECACHE: JSON.stringify(files.filter(opensBoard)),
    BUILD_SHELL: JSON.stringify(await readFile(path('dist/public/index.html'), 'utf8')),
  },
  outfile: path('dist/public/sw.js'),
});

// The Worker imports the generated tools/list, so it is refreshed before bundling.
await generateToolList();

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

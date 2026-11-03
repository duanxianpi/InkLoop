import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

// Compile TypeScript in memory; resolve external packages from this project.
export async function loadSource(path) {
  const output = await build({
    entryPoints: [path],
    bundle: true,
    packages: 'external',
    platform: 'node',
    format: 'cjs',
    write: false,
    jsx: 'automatic',
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output.outputFiles[0].text)(
    createRequire(resolve('package.json')),
    module,
    module.exports,
  );
  return module.exports;
}

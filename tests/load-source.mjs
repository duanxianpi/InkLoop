import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

// Compile TypeScript in memory; resolve external packages from this project.
// Several paths share one bundle, so classes such as HttpError keep a single identity.
export async function loadSource(...paths) {
  const entry =
    paths.length === 1
      ? { entryPoints: paths }
      : {
          stdin: {
            contents: paths.map((path) => `export * from './${path}';`).join('\n'),
            resolveDir: resolve('.'),
            loader: 'ts',
          },
        };
  const output = await build({
    ...entry,
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

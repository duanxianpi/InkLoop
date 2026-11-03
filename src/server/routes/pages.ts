import type { Context } from 'hono';
import type { ServerEnv } from '../env';

/** Serve the same static shell for every React page; all page data comes from APIs. */
export async function serveSpa(c: Context<ServerEnv>) {
  const asset = await c.env.ASSETS.fetch(new Request(new URL('/index.html', c.req.url)));
  const response = new Response(asset.body, asset);
  response.headers.set(
    'Content-Security-Policy',
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  );
  return response;
}

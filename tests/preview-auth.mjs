// Local-only SPA fixtures. No real credentials, OAuth clients or cloud resources are created.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const origin = 'http://127.0.0.1:4317';
const publicRoot = resolve('dist/public');
let revoked = false;
const server = createServer(async (request, response) => {
  const path = new URL(request.url, origin).pathname;
  if (path.startsWith('/assets/')) {
    try {
      const file = resolve(publicRoot, '.' + path);
      if (!file.startsWith(publicRoot + '/assets/')) throw new Error('Invalid asset');
      response.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'text/javascript');
      response.end(await readFile(file));
    } catch {
      response.writeHead(404);
      response.end();
    }
    return;
  }
  if (
    path.startsWith('/api/') ||
    path.startsWith('/auth/') ||
    path === '/logout' ||
    (path === '/authorize' && request.method === 'POST')
  ) {
    response.setHeader('Content-Type', 'application/json');
    if (path === '/api/status') response.end('{"initialized":false}');
    else if (path === '/auth/consent')
      response.end(
        JSON.stringify({
          clientName: 'Local preview client <img src=x>',
          clientDomain: null,
          redirectHost: '127.0.0.1',
          redirectIsLoopback: true,
          resource: origin + '/mcp',
          scopes: ['mcp:read', 'mcp:write'],
          handle: 'fixture-only',
        }),
      );
    else if (path === '/authorize') response.end(JSON.stringify({ redirectTo: origin + '/login' }));
    else if (path === '/api/grants/revoke') {
      revoked = true;
      response.end('{"ok":true}');
    } else if (path === '/api/grants')
      response.end(
        JSON.stringify({
          items: revoked
            ? []
            : [
                {
                  id: 'fixture',
                  clientId: 'Local preview client',
                  scope: ['mcp:read'],
                  createdAt: 0,
                },
              ],
        }),
      );
    else {
      response.statusCode = 400;
      response.end('{"error":"Preview only: no credentials are created."}');
    }
    return;
  }
  response.setHeader('Content-Type', 'text/html');
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  );
  response.end(await readFile(resolve(publicRoot, 'index.html')));
});
server.listen(4317, '127.0.0.1', () => console.log('SPA fixtures: ' + origin + '/setup'));

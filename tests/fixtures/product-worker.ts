// Test-only Worker, never deployed: the real application, plus /__test/mcp, which runs the real MCP
// endpoint and services as the owner without the OAuth round trip (covered by
// auth-integration.test.mjs), and /__test/login, which sets a seeded session cookie for previews.
import app, { ChangeHub } from '../../src/server/index';
import { appContext, type Env } from '../../src/server/env';
import { handleMcp } from '../../src/server/mcp/handler';
import { createServices } from '../../src/server/services';

export { ChangeHub };

// The application's session cookie is `__Host-owner`, which browsers store only with `Secure`.
// Safari rejects Secure cookies on http://localhost, so over plain http the preview keeps the
// session under a non-Secure name and maps it back for the application.
const SESSION = '__Host-owner';
const PREVIEW_SESSION = 'preview-owner';

function toApplication(request: Request) {
  const cookie = request.headers.get('Cookie');
  if (!cookie?.includes(PREVIEW_SESSION + '=')) return request;
  // Cookies are not per port: drop a session left by another local server under the real name.
  const cookies = cookie
    .split(';')
    .map((part) => part.trim())
    .filter((part) => !part.startsWith(SESSION + '='))
    .map((part) =>
      part.startsWith(PREVIEW_SESSION + '=') ? SESSION + part.slice(PREVIEW_SESSION.length) : part,
    );
  const headers = new Headers(request.headers);
  headers.set('Cookie', cookies.join('; '));
  return new Request(request, { headers });
}

function toPreview(response: Response) {
  const cookies = response.headers.getSetCookie();
  if (!cookies.some((cookie) => cookie.startsWith(SESSION + '='))) return response;
  const rewritten = new Response(response.body, response);
  rewritten.headers.delete('Set-Cookie');
  for (const cookie of cookies)
    rewritten.headers.append(
      'Set-Cookie',
      cookie.startsWith(SESSION + '=')
        ? cookie.replace(SESSION + '=', PREVIEW_SESSION + '=').replace(/;\s*Secure/i, '')
        : cookie,
    );
  return rewritten;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    const plainHttp = url.protocol === 'http:';
    if (url.pathname === '/__test/login') {
      const response = new Response(null, {
        status: 302,
        headers: {
          Location: '/app',
          'Set-Cookie': `${SESSION}=${url.searchParams.get('token')}; Path=/; HttpOnly; Secure; SameSite=Lax`,
        },
      });
      return plainHttp ? toPreview(response) : response;
    }
    if (url.pathname !== '/__test/mcp') {
      if (!plainHttp) return app.fetch(request, env, ctx);
      return toPreview(await app.fetch(toApplication(request), env, ctx));
    }
    const current = await env.DB.prepare('SELECT auth_epoch FROM auth_state WHERE id = 1').first<{
      auth_epoch: number;
    }>();
    const authEpoch = Number(url.searchParams.get('epoch') ?? current!.auth_epoch);
    const owner = {
      ownerId: 1,
      authEpoch,
      scopes: ['mcp:read', 'mcp:write'],
      requireScope() {},
    };
    return handleMcp(request, owner, () => createServices(appContext(env, authEpoch)));
  },
};

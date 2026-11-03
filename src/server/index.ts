import { Hono } from 'hono';
import { AuthorizationError, CimdFetchError } from '@cloudflare/workers-oauth-provider';
import { assert, boundedText, HttpError, json, setCookie } from './auth/common';
import { ensureBootstrap, finish, options } from './auth/owner';
import { listGrants, prepareConsent, revokeGrant, submitConsent } from './auth/handlers';
import { handleOAuth, withOAuth } from './auth/oauth';
import {
  authRateLimit,
  requestContext,
  requirePageSession,
  requireSession,
  requireSetup,
  sameOriginMutation,
  securityHeaders,
} from './middleware';
import { api } from './routes/api';
import { serveSpa } from './routes/pages';
import type { ServerEnv } from './env';

export { ChangeHub } from './hub';

// One Worker fetch, one Hono route tree. SDKs handle only their protocol endpoints.
const app = new Hono<ServerEnv>();
app.use('*', securityHeaders, requestContext);
app.onError((error, c) => {
  if (error instanceof HttpError) return json({ error: error.message }, error.status);
  if (error instanceof AuthorizationError || error instanceof CimdFetchError)
    return json({ error: 'Invalid OAuth request' }, 400);
  console.error('request_failed', error.name);
  return c.json({ error: 'internal_error' }, 500);
});
app.notFound((c) => c.json({ error: 'not_found' }, 404));

// Ordinary build assets are public code; user data remains behind authenticated APIs.
app.get('/assets/*', (c) => c.env.ASSETS.fetch(c.req.raw));
app.get('/setup', async (c) => {
  await ensureBootstrap(c.env);
  return serveSpa(c);
});
app.get('/login', serveSpa);
app.get('/recover', serveSpa);
app.on(
  'GET',
  ['/', '/app', '/settings/passkeys/add', '/settings/connected-apps'],
  requirePageSession,
  serveSpa,
);
app.get('/authorize', authRateLimit, requireSetup, requirePageSession, serveSpa);

// Public setup state and the Passkey ceremonies. Ceremony handlers perform their own proof checks.
app.get('/api/status', (c) => c.json({ initialized: !!c.get('authState').initialized_at }));
app.use('/auth/*', authRateLimit, sameOriginMutation);
app.post('/auth/:purpose/options', (c) => {
  const purpose = c.req.param('purpose');
  assert(['bootstrap', 'recovery', 'login', 'add'].includes(purpose), 404, 'Not found');
  return options(c.req.raw, c.env, purpose);
});
app.post('/auth/:purpose/finish', (c) => {
  const purpose = c.req.param('purpose');
  assert(['bootstrap', 'recovery', 'login', 'add'].includes(purpose), 404, 'Not found');
  const origin = c.get('authState').canonical_origin;
  return finish(c.req.raw, origin ? withOAuth(c.env, origin) : c.env, purpose);
});
app.post('/auth/consent', requireSetup, requireSession, (c) => {
  const origin = c.get('authState').canonical_origin!;
  return prepareConsent(c.req.raw, withOAuth(c.env, origin), origin);
});
app.post('/authorize', authRateLimit, requireSetup, requireSession, sameOriginMutation, (c) => {
  const origin = c.get('authState').canonical_origin!;
  return submitConsent(c.req.raw, withOAuth(c.env, origin), origin);
});

// OAuth protocol endpoints and the protected MCP transport stay inside the supported SDK.
app.use('/oauth/*', authRateLimit);
for (const route of ['/oauth/*', '/.well-known/*', '/mcp'])
  app.all(route, requireSetup, async (c) => {
    let request = c.req.raw;
    const origin = c.get('authState').canonical_origin!;
    if (c.req.path === '/mcp') {
      const requestOrigin = c.req.header('Origin');
      assert(!requestOrigin || requestOrigin === origin, 403, 'Origin rejected');
    } else if (c.req.method === 'POST') {
      request = new Request(request, { body: await boundedText(request) });
    }
    return handleOAuth(request, c.env, c.executionCtx as ExecutionContext, origin);
  });

app.post('/logout', requireSession, sameOriginMutation, async (c) => {
  await c.env.DB.prepare('DELETE FROM web_sessions WHERE digest=?')
    .bind(c.get('user').digest)
    .run();
  return json({ ok: true }, 200, { 'Set-Cookie': setCookie('__Host-owner', '', 0) });
});

app.use('/api/*', requireSession, sameOriginMutation);
app.get('/api/me', (c) =>
  c.json({ ownerId: c.get('user').owner_id, authEpoch: c.get('user').auth_epoch }),
);
app.get('/api/grants', (c) => listGrants(c.req.raw, c.env, c.get('user')));
app.post('/api/grants/revoke', (c) =>
  revokeGrant(c.req.raw, withOAuth(c.env, c.get('authState').canonical_origin!), c.get('user')),
);
app.route('/api', api);

export default app;

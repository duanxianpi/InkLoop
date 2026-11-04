// hono/tiny (PatternRouter) compiles each route when it is added, at module load. The default
// router compiles the whole table on the first request, which costs that request several ms of CPU.
import { Hono } from 'hono/tiny';
import { AuthorizationError, CimdFetchError } from '@cloudflare/workers-oauth-provider';
import { assert, json, setCookie } from './auth/common';
import { boundedText } from './http/body';
import { errorResponse, HttpError } from './http/errors';
import { DomainError } from '../shared/errors';
import { LIMITS } from '../shared/limits';
import { PAGES } from '../shared/pages';
import { handleMcp } from './mcp/handler';
import { createServices } from './services';
import {
  changePassword,
  ensureBootstrap,
  login,
  passwordParams,
  recover,
  setup,
} from './auth/owner';
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
import { appContext, type ServerEnv } from './env';

export { ChangeHub } from './hub';

// One Worker fetch, one Hono route tree. The OAuth SDK handles only its protocol endpoints.
const app = new Hono<ServerEnv>();
app.use('*', securityHeaders, requestContext);
app.onError((error, c) => {
  if (error instanceof HttpError || error instanceof DomainError) return errorResponse(error);
  if (error instanceof AuthorizationError)
    return json({ error: error.code, message: error.description }, 400);
  if (error instanceof CimdFetchError)
    return json(
      { error: 'client_metadata_unavailable', message: "Couldn't load the app's client metadata" },
      400,
    );
  console.error('request_failed', error.name);
  return c.json({ error: 'internal_error' }, 500);
});
app.notFound((c) => c.json({ error: 'not_found' }, 404));

// Matching /assets/* files are served by Cloudflare's asset layer before this Worker.
// A missing asset must stay a 404; it must never fall through to the SPA shell.
app.use('/setup', authRateLimit);
app.use('/authorize', authRateLimit, requireSetup);
for (const page of PAGES) {
  if (page.access === 'session') app.get(page.path, requirePageSession, serveSpa);
  else if (page.purpose === 'setup')
    app.get(page.path, async (c) => {
      if (!c.get('authState').initialized_at) await ensureBootstrap(c.env);
      return serveSpa(c);
    });
  else app.get(page.path, serveSpa);
}

// Public setup state and password sign-in. Setup and recovery prove the D1 claim/recovery key.
app.get('/api/status', (c) => {
  const initialized = !!c.get('authState').initialized_at;
  // Before setup only: the exact D1 Studio page holding the claim key (it names the account).
  const studio = !initialized && c.env.D1_CONSOLE_URL ? { d1ConsoleUrl: c.env.D1_CONSOLE_URL } : {};
  return c.json({ initialized, ...studio });
});
// Browsers and some MCP clients look for an icon at the root.
app.get('/favicon.ico', (c) =>
  c.env.ASSETS.fetch(new Request(new URL('/assets/brand/inkloop-v2.png', c.req.url))),
);
app.use('/auth/*', authRateLimit, sameOriginMutation);
app.get('/auth/password', (c) => passwordParams(c.env, c.get('authState')));
app.post('/auth/setup', (c) => setup(c.req.raw, c.env, c.get('authState')));
app.post('/auth/login', (c) => login(c.req.raw, c.env, c.get('authState')));
app.post('/auth/recover', (c) => {
  const state = c.get('authState');
  return recover(c.req.raw, state.canonical_origin ? withOAuth(c.env, state) : c.env, state);
});
app.post('/auth/password', requireSession, (c) =>
  changePassword(c.req.raw, c.env, c.get('authState'), c.get('user')),
);
app.post('/auth/consent', requireSetup, requireSession, (c) => {
  const origin = c.get('authState').canonical_origin!;
  return prepareConsent(c.req.raw, withOAuth(c.env, c.get('authState')), origin);
});
app.post('/authorize', requireSession, sameOriginMutation, (c) => {
  return submitConsent(c.req.raw, withOAuth(c.env, c.get('authState')), c.get('user'));
});

// OAuth protocol endpoints stay inside the supported SDK, which also authenticates /mcp before
// handing it to the hand-rolled MCP endpoint.
app.use('/oauth/*', authRateLimit);
for (const route of ['/oauth/*', '/.well-known/*', '/mcp'])
  app.all(route, requireSetup, async (c) => {
    let request = c.req.raw;
    const origin = c.get('authState').canonical_origin!;
    if (c.req.path === '/mcp') {
      const requestOrigin = c.req.header('Origin');
      assert(!requestOrigin || requestOrigin === origin, 403, 'Origin rejected');
    } else if (c.req.method === 'POST') {
      try {
        request = new Request(request, {
          body: await boundedText(request, LIMITS.authRequestBytes),
        });
      } catch (error) {
        if (error instanceof HttpError)
          return json({ error: 'invalid_request', error_description: error.message }, error.status);
        throw error;
      }
    }
    return handleOAuth(
      request,
      c.env,
      c.executionCtx as ExecutionContext,
      c.get('authState'),
      (incoming, owner) =>
        handleMcp(incoming, owner, () => createServices(appContext(c.env, owner.authEpoch))),
    );
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
  revokeGrant(c.req.raw, withOAuth(c.env, c.get('authState')), c.get('user')),
);
app.route('/api', api);

export default app;

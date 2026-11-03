import { createMiddleware } from 'hono/factory';
import { assert, csrf, json, session, state } from './auth/common';
import type { ServerEnv } from './env';

export const requestContext = createMiddleware<ServerEnv>(async (c, next) => {
  const url = new URL(c.req.url);
  assert(c.req.url.length <= 16384, 414, 'URL too long');
  const current = await state(c.env);
  if (current.canonical_origin)
    assert(
      url.origin === current.canonical_origin,
      421,
      'Canonical origin mismatch; use the original deployment address',
    );
  c.set('authState', current);
  await next();
});

export const authRateLimit = createMiddleware<ServerEnv>(async (c, next) => {
  if (c.env.AUTH_LIMITER) {
    const result = await c.env.AUTH_LIMITER.limit({
      key: `${new URL(c.req.url).hostname}:${c.req.header('CF-Connecting-IP') ?? 'unknown'}`,
    });
    if (!result.success)
      return json({ error: 'rate_limited', message: 'Try again shortly' }, 429, {
        'Retry-After': '60',
      });
  }
  await next();
});

export const requireSession = createMiddleware<ServerEnv>(async (c, next) => {
  const user = await session(c.req.raw, c.env);
  assert(user, 401, 'Owner session required');
  c.set('user', user);
  await next();
});

export const requirePageSession = createMiddleware<ServerEnv>(async (c, next) => {
  const url = new URL(c.req.url);
  if (!c.get('authState').initialized_at) return c.redirect(url.origin + '/setup', 302);
  const user = await session(c.req.raw, c.env);
  if (!user)
    return c.redirect(
      url.origin + '/login?returnTo=' + encodeURIComponent(url.pathname + url.search),
      302,
    );
  c.set('user', user);
  await next();
});

export const sameOriginMutation = createMiddleware<ServerEnv>(async (c, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method))
    csrf(c.req.raw, c.get('authState').canonical_origin ?? new URL(c.req.url).origin);
  await next();
});

export const requireSetup = createMiddleware<ServerEnv>(async (c, next) => {
  if (!c.get('authState').canonical_origin) return json({ error: 'setup_required' }, 503);
  await next();
});

export const securityHeaders = createMiddleware<ServerEnv>(async (c, next) => {
  await next();
  if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'no-store');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'same-origin');
  c.header('Strict-Transport-Security', 'max-age=31536000');
});

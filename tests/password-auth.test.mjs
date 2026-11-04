import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { build } from 'esbuild';
import { applyMigrations } from './migrations.mjs';
const require = createRequire(import.meta.url);
const { Miniflare, convertV4MiniflareOptions } = require(
  require.resolve('miniflare', { paths: [require.resolve('wrangler/package.json')] }),
);

// Password sign-in end to end against local workerd and D1: setup with the claim key, sign-in
// with failure delays, password change and recovery with the recovery key. The browser's PBKDF2
// step is reproduced with Node's implementation.

const origin = 'https://whiteboard.example';
const ITERATIONS = 600000;

const credential = (password) => {
  const salt = randomBytes(16).toString('base64url');
  return {
    salt,
    iterations: ITERATIONS,
    derived: stretch(password, { salt, iterations: ITERATIONS }),
  };
};
const stretch = (password, { salt, iterations }) =>
  pbkdf2Sync(
    password.normalize('NFC'),
    Buffer.from(salt, 'base64url'),
    iterations,
    32,
    'sha256',
  ).toString('base64url');

test('password setup, sign-in throttling, change and recovery', async () => {
  const bundle = await build({
    entryPoints: [new URL('fixtures/product-worker.ts', import.meta.url).pathname],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    external: ['cloudflare:*', 'node:*'],
    write: false,
    logLevel: 'warning',
  });
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: bundle.outputFiles[0].text,
      compatibilityDate: '2026-11-02',
      compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'],
      d1Databases: ['DB'],
      kvNamespaces: ['OAUTH_KV'],
      r2Buckets: ['STORAGE'],
      durableObjects: { CHANGE_HUB: { className: 'ChangeHub', useSQLite: true } },
      serviceBindings: { ASSETS: () => new Response('shell') },
    }),
  );
  try {
    const db = await mf.getD1Database('DB');
    await applyMigrations(db);
    const send = (path, body, cookie, headers = {}) =>
      mf.dispatchFetch(origin + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Origin: origin,
          'Content-Type': 'application/json',
          ...(cookie ? { cookie } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const json = async (response, status) => {
      const data = await response.json();
      assert.equal(response.status, status, JSON.stringify(data));
      return data;
    };
    const cookieOf = (response) => response.headers.get('set-cookie').split(';')[0];
    const params = async () => json(await send('/auth/password'), 200);
    const login = async (password) =>
      send('/auth/login', { derived: stretch(password, await params()) });

    // Setup: the claim key and the exact HTTPS origin, in one transaction.
    assert.equal((await send('/auth/password')).status, 409);
    await mf.dispatchFetch(origin + '/setup');
    const claim = (
      await db.prepare("SELECT secret_display FROM admin_keys WHERE purpose='bootstrap'").first()
    ).secret_display;
    const first = credential('one two three');
    assert.equal(
      (
        await json(
          await send('/auth/setup', {
            key: 'x'.repeat(43),
            canonicalOrigin: origin,
            password: first,
          }),
          403,
        )
      ).error,
      'forbidden',
    );
    assert.equal(
      (
        await send('/auth/setup', {
          key: claim,
          canonicalOrigin: 'https://other.example',
          password: first,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await send('/auth/setup', {
          key: claim,
          canonicalOrigin: origin,
          password: { ...first, iterations: 1000 },
        })
      ).status,
      400,
      'weak KDF parameters are rejected',
    );
    const setup = await send('/auth/setup', {
      key: claim,
      canonicalOrigin: origin,
      password: first,
    });
    await json(setup, 200);
    const setupCookie = cookieOf(setup);
    assert.equal((await send('/api/me', undefined, setupCookie)).status, 200);
    assert.equal(
      (await send('/auth/setup', { key: claim, canonicalOrigin: origin, password: first })).status,
      409,
    );
    const stored = await db.prepare('SELECT * FROM owner_password').first();
    assert.equal(stored.salt, first.salt);
    assert.notEqual(stored.verifier, first.derived, 'only a hash of the stretched value is stored');
    assert.equal(
      (await db.prepare("SELECT secret_display FROM admin_keys WHERE purpose='bootstrap'").first())
        .secret_display,
      null,
    );
    assert.deepEqual(await params(), { salt: first.salt, iterations: ITERATIONS });

    // Any password is allowed, including a short one; the owner chooses.
    // Sign-in: five free failures, then increasing delays; success resets them.
    assert.equal((await send('/auth/login', { derived: 'short' })).status, 400);
    assert.equal(
      (
        await send('/auth/login', { derived: stretch('one two three', first) }, undefined, {
          Origin: 'https://evil.example',
        })
      ).status,
      403,
    );
    for (let i = 0; i < 5; i++) assert.equal((await login('wrong')).status, 401);
    const throttled = await json(await login('one two three'), 429);
    assert.equal(throttled.error, 'rate_limited');
    const throttle = await db.prepare('SELECT * FROM login_throttle').first();
    assert.equal(throttle.failures, 5);
    await db.prepare('UPDATE login_throttle SET retry_after = 0').run();
    assert.equal((await login('wrong')).status, 401);
    const delayed = await db.prepare('SELECT * FROM login_throttle').first();
    assert.ok(delayed.retry_after - Math.floor(Date.now() / 1000) >= 1, 'the delay doubles');
    await db.prepare('UPDATE login_throttle SET retry_after = 0').run();
    const signedIn = await login('one two three');
    await json(signedIn, 200);
    const laptop = cookieOf(signedIn);
    assert.deepEqual(await db.prepare('SELECT failures, retry_after FROM login_throttle').first(), {
      failures: 0,
      retry_after: 0,
    });

    // Change: requires the current password; other sessions end, this one stays.
    assert.equal(
      (await send('/auth/password', { current: 'x', password: credential('a') })).status,
      401,
    );
    assert.equal(
      (
        await send(
          '/auth/password',
          { current: stretch('wrong', first), password: credential('a') },
          laptop,
        )
      ).status,
      401,
    );
    await json(
      await send(
        '/auth/password',
        { current: stretch('one two three', first), password: credential('a') },
        laptop,
      ),
      200,
    );
    assert.equal((await send('/api/me', undefined, laptop)).status, 200);
    assert.equal((await send('/api/me', undefined, setupCookie)).status, 401);
    assert.equal((await login('one two three')).status, 401);
    await json(await login('a'), 200);

    // Recovery: the recovery key sets a new password and invalidates everything from before.
    const recoveryKey = (
      await db.prepare("SELECT secret_display FROM admin_keys WHERE purpose='recovery'").first()
    ).secret_display;
    for (let i = 0; i < 5; i++) await login('wrong');
    assert.equal((await login('a')).status, 429);
    assert.equal(
      (await send('/auth/recover', { key: 'y'.repeat(43), password: credential('b') })).status,
      403,
    );
    const epoch = (await db.prepare('SELECT auth_epoch FROM auth_state').first()).auth_epoch;
    const recovered = await send('/auth/recover', { key: recoveryKey, password: credential('b') });
    await json(recovered, 200);
    assert.equal(
      (await db.prepare('SELECT auth_epoch FROM auth_state').first()).auth_epoch,
      epoch + 1,
    );
    assert.equal((await send('/api/me', undefined, laptop)).status, 401);
    assert.equal((await send('/api/me', undefined, cookieOf(recovered))).status, 200);
    assert.equal(
      (await send('/auth/recover', { key: recoveryKey, password: credential('c') })).status,
      403,
      'the recovery key is replaced',
    );
    assert.notEqual(
      (await db.prepare("SELECT secret_display FROM admin_keys WHERE purpose='recovery'").first())
        .secret_display,
      recoveryKey,
    );
    await json(await login('b'), 200);

    // A deployment migrated from Passkeys has no password until recovery sets one.
    await db.prepare('DELETE FROM owner_password').run();
    assert.equal((await json(await send('/auth/password'), 409)).error, 'password_not_set');
  } finally {
    await mf.dispose();
  }
});

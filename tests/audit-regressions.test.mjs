import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { Hono } from 'hono';
import { loadSource } from './load-source.mjs';
import { deploy, d1ConsoleUrl } from '../src/tooling/deploy.mjs';

const { securityHeaders, authRateLimit } = await loadSource('src/server/middleware.ts');
const { boundedText, boundedJson } = await loadSource('src/server/http/body.ts');

test('response policy preserves explicit private caches and defaults to no-store', async () => {
  const app = new Hono();
  app.use('*', securityHeaders);
  app.get(
    '/image',
    () =>
      new Response('image', {
        headers: { 'Cache-Control': 'private, max-age=31536000, immutable' },
      }),
  );
  app.get('/data', (c) => c.json({ owner: 1 }));
  assert.equal(
    (await app.request('/image')).headers.get('cache-control'),
    'private, max-age=31536000, immutable',
  );
  assert.equal((await app.request('/data')).headers.get('cache-control'), 'no-store');
});

test('rate limiting stops the handler before any setup work', async () => {
  let calls = 0;
  const app = new Hono();
  app.get('/setup', authRateLimit, (c) => {
    calls++;
    return c.text('setup');
  });
  const denied = await app.request(
    '/setup',
    {},
    { AUTH_LIMITER: { limit: async () => ({ success: false }) } },
  );
  assert.equal(denied.status, 429);
  assert.equal(calls, 0);
  assert.equal(denied.headers.get('retry-after'), '60');
});

test('shared body reader handles media type casing, empty protocol bodies and invalid UTF-8', async () => {
  const request = (body, contentType = 'Application/JSON; charset=utf-8') =>
    new Request('https://example.test', {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body,
    });
  assert.deepEqual(await boundedJson(request('{"ok":true}'), 100), { ok: true });
  assert.equal(await boundedText(request(undefined), 100), '');
  await assert.rejects(
    boundedText(request(new Uint8Array([0xff])), 100),
    (e) => e.code === 'invalid_request',
  );
  await assert.rejects(
    boundedJson(request('{}', 'text/plain'), 100),
    (e) => e.code === 'unsupported_media_type',
  );
});

test('all pinned drawing asset URLs resolve to built local files', async () => {
  const { canvasAssetUrls } = await loadSource('src/web/canvas/assets.ts');
  let count = 0;
  for (const group of Object.values(canvasAssetUrls)) {
    for (const url of Object.values(group)) {
      assert.match(url, /^\/assets\/tldraw\/3\.15\.6\//);
      await access(new URL('../dist/public' + url.split('#')[0], import.meta.url));
      count++;
    }
  }
  assert.ok(count > 100);
});

function runner(results) {
  const calls = [];
  return {
    calls,
    execute(command, args) {
      calls.push({ command, args });
      return results.shift() ?? { status: 0 };
    },
  };
}

test('deployment builds and checks R2 before migrations and stops entirely on build failure', () => {
  const failed = runner([{ status: 2 }]);
  assert.equal(deploy([], failed.execute), 2);
  assert.equal(failed.calls.length, 1);
  assert.match(failed.calls[0].args[0], /\/build\.mjs$/);
  const success = runner([
    { status: 0 },
    { status: 0 },
    { status: 0 },
    { status: 0, stdout: JSON.stringify({ accounts: [{ id: 'acct' }] }) },
    { status: 0, stdout: JSON.stringify([{ name: 'inkloop-db', uuid: 'db-uuid' }]) },
  ]);
  assert.equal(deploy([], success.execute), 0);
  assert.equal(success.calls.length, 6);
  assert.match(success.calls[0].args[0], /\/build\.mjs$/);
  assert.deepEqual(success.calls[1].args, ['r2', 'bucket', 'list']);
  assert.deepEqual(success.calls[2].args, ['d1', 'migrations', 'apply', 'DB', '--remote']);
  assert.deepEqual(success.calls[5].args, [
    'deploy',
    '--experimental-auto-create',
    '--var',
    'D1_CONSOLE_URL:https://dash.cloudflare.com/acct/workers/d1/databases/db-uuid/metrics',
  ]);
  // A failed lookup never blocks the deployment; the link is just omitted.
  const lookupFails = runner([{ status: 0 }, { status: 0 }, { status: 0 }, { status: 1 }]);
  assert.equal(deploy([], lookupFails.execute), 0);
  assert.deepEqual(lookupFails.calls.at(-1).args, ['deploy', '--experimental-auto-create']);
});

test('setup and recovery open the DB overview, with a D1-list fallback for unavailable metadata', () => {
  const who = { status: 0, stdout: JSON.stringify({ accounts: [{ id: 'acct' }] }) };
  const single = runner([
    who,
    { status: 0, stdout: JSON.stringify([{ name: 'inkloop-db', uuid: 'db-uuid' }]) },
  ]);
  assert.equal(
    d1ConsoleUrl((args) => single.execute('wrangler', args)),
    'https://dash.cloudflare.com/acct/workers/d1/databases/db-uuid/metrics',
  );
  assert.deepEqual(
    single.calls.map(({ args }) => args),
    [
      ['whoami', '--json'],
      ['d1', 'list', '--json'],
    ],
  );
  for (const missing of [
    { status: 1 },
    { status: 0, stdout: 'not JSON' },
    { status: 0, stdout: '[]' },
    { status: 0, stdout: '{}' },
  ]) {
    const fallback = runner([who, missing]);
    assert.equal(
      d1ConsoleUrl((args) => fallback.execute('wrangler', args)),
      'https://dash.cloudflare.com/acct/workers/d1',
    );
  }
  for (const result of [
    { status: 1 },
    { status: 0, stdout: 'invalid JSON' },
    { status: 0, stdout: JSON.stringify({ accounts: [] }) },
    { status: 0, stdout: JSON.stringify({ accounts: [{ id: 'a' }, { id: 'b' }] }) },
  ])
    assert.equal(
      d1ConsoleUrl(() => result),
      null,
    );
});

test('deployment fails closed on migration errors, including after initial provisioning', () => {
  const failed = runner([{ status: 0 }, { status: 0 }, { status: 1 }]);
  assert.equal(deploy([], failed.execute), 1);
  assert.equal(failed.calls.length, 3);
  const initial = runner([
    { status: 0 },
    { status: 0 },
    { status: 1, stderr: "Couldn't find a D1 DB" },
    { status: 0 },
    { status: 3 },
  ]);
  assert.equal(deploy([], initial.execute), 3);
  assert.equal(initial.calls.length, 5);
  assert.match(initial.calls[3].args[1], /\/maintenance\.ts$/);
  assert.deepEqual(initial.calls[4].args, ['d1', 'migrations', 'apply', 'DB', '--remote']);
});

test('R2 check failures stop before cloud mutations and distinguish activation from other errors', (t) => {
  const messages = [];
  t.mock.method(console, 'error', (message) => messages.push(message));
  for (const failure of [
    { status: 1, stderr: 'Please enable R2 through the Cloudflare Dashboard. [code: 10042]' },
    { status: 1, stderr: 'Please enable R2 Subscription for your account.' },
    { status: 1, stderr: 'Authentication error [code: 10000]' },
    { status: 7, stderr: 'Connection failed' },
    { status: null, error: new Error('Unable to start Wrangler') },
  ]) {
    messages.length = 0;
    const attempt = runner([{ status: 0 }, failure]);
    assert.equal(deploy(['--config', 'wrangler.jsonc'], attempt.execute), failure.status ?? 1);
    assert.equal(attempt.calls.length, 2);
    assert.deepEqual(attempt.calls[1].args, ['r2', 'bucket', 'list', '--config', 'wrangler.jsonc']);
    assert.match(
      messages.join('\n'),
      /10042|Please enable/.test(failure.stderr ?? '') ? /subscription checkout/ : /credentials/,
    );
  }
});

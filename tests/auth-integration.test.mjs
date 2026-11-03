import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
const require = createRequire(import.meta.url);
const { unstable_readConfig } = require('wrangler');
const { Miniflare, convertV4MiniflareOptions } = require(
  require.resolve('miniflare', { paths: [require.resolve('wrangler/package.json')] }),
);

test('Hono SPA routing, direct static assets, owner sessions and OAuth lifecycle', async () => {
  const html = await readFile(new URL('../dist/public/index.html', import.meta.url));
  const assetPath = html.toString().match(/src="([^"]+\.js)"/)[1];
  const javascript = await readFile(new URL('../dist/public' + assetPath, import.meta.url));
  const config = unstable_readConfig(
    { config: new URL('../wrangler.jsonc', import.meta.url).pathname },
    { hideWarnings: true },
  );
  assert.deepEqual(config.assets.run_worker_first, ['/*', '!/assets/*']);
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      scriptPath: new URL('../dist/worker.js', import.meta.url).pathname,
      compatibilityDate: '2026-11-02',
      compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'],
      d1Databases: ['DB'],
      kvNamespaces: ['OAUTH_KV'],
      r2Buckets: ['STORAGE'],
      durableObjects: { CHANGE_HUB: { className: 'ChangeHub', useSQLite: true } },
      assets: {
        directory: new URL('../dist/public', import.meta.url).pathname,
        binding: 'ASSETS',
        routerConfig: { has_user_worker: true },
        run_worker_first: config.assets.run_worker_first,
        assetConfig: { html_handling: 'none', not_found_handling: 'none' },
      },
      ratelimits: { AUTH_LIMITER: { namespace_id: '1001', simple: { limit: 60, period: 60 } } },
    }),
  );
  try {
    // No auth tables exist yet: serving JS must not enter requestContext or query D1.
    const publicAsset = await mf.dispatchFetch('https://whiteboard.example' + assetPath);
    assert.equal(publicAsset.status, 200);
    assert.equal(await publicAsset.text(), javascript.toString());
    assert.match(publicAsset.headers.get('content-type'), /javascript/);
    assert.equal(publicAsset.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.equal(publicAsset.headers.get('x-content-type-options'), 'nosniff');
    const db = await mf.getD1Database('DB');
    for (const file of [
      '0001_auth.sql',
      '0002_probe_and_revocation.sql',
      '0003_connected_apps.sql',
    ])
      await db.exec(await readFile(new URL('../migrations/' + file, import.meta.url), 'utf8'));
    const origin = 'https://whiteboard.example';
    const setup = await mf.dispatchFetch(origin + '/setup');
    assert.equal(setup.status, 200, await setup.clone().text());
    const setupHtml = await setup.text();
    assert.equal(setupHtml, html.toString());
    assert.match(setupHtml, /src="\/assets\//);
    assert.deepEqual(await (await mf.dispatchFetch(origin + '/api/status')).json(), {
      initialized: false,
    });
    const bootstrap = await db
      .prepare("SELECT secret_display FROM admin_keys WHERE purpose='bootstrap'")
      .first();
    assert.ok(bootstrap.secret_display);
    assert.ok(!setupHtml.includes(bootstrap.secret_display));
    for (const path of ['/auth/bootstrap/options', '/auth/bootstrap/finish']) {
      for (const value of [null, [], 'text', 7, true]) {
        const invalid = await mf.dispatchFetch(origin + path, {
          method: 'POST',
          headers: { Origin: origin, 'Content-Type': 'application/json' },
          body: JSON.stringify(value),
        });
        assert.equal(invalid.status, 400, path);
        assert.equal((await invalid.json()).error, 'invalid_request');
      }
    }
    const ceremony = await mf.dispatchFetch(origin + '/auth/bootstrap/options', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: bootstrap.secret_display, canonicalOrigin: origin }),
    });
    assert.equal(ceremony.status, 200);
    const preparedCeremony = await ceremony.json();
    assert.ok(preparedCeremony.id);
    assert.ok(preparedCeremony.publicKey.challenge);
    assert.equal(preparedCeremony.publicKey.rp.id, 'whiteboard.example');
    await db.prepare('INSERT INTO owner VALUES(1,unixepoch())').run();
    await db
      .prepare(
        'UPDATE auth_state SET initialized_at=unixepoch(),canonical_origin=?,rp_id=?,auth_epoch=3',
      )
      .bind(origin, 'whiteboard.example')
      .run();
    const token = randomBytes(32).toString('base64url');
    await db
      .prepare('INSERT INTO web_sessions VALUES(?,1,3,unixepoch()+3600,unixepoch())')
      .bind(createHash('sha256').update(token).digest('base64url'))
      .run();
    const request = (path, init) =>
      mf.dispatchFetch(origin + path, { ...init, redirect: 'manual' });
    const auth = { cookie: '__Host-owner=' + token };
    const anonymous = await request('/app');
    assert.equal(anonymous.status, 302);
    assert.equal(anonymous.headers.get('location'), origin + '/login?returnTo=%2Fapp');
    assert.equal((await request('/index.html')).status, 404);
    const noSession = await request('/api/me');
    assert.equal(noSession.status, 401);
    assert.deepEqual(await noSession.json(), {
      error: 'unauthorized',
      message: 'Owner session required',
    });
    assert.equal((await request('/api/protected', { method: 'POST' })).status, 401);
    const canvas = await request('/app', { headers: auth });
    assert.equal(canvas.status, 200);
    assert.equal(await canvas.text(), html.toString());
    assert.equal(canvas.headers.get('cache-control'), 'no-store');
    assert.equal((await (await request('/api/me', { headers: auth })).json()).ownerId, 1);
    assert.equal(
      (await (await request('/api/problems', { headers: auth })).json()).error,
      'not_implemented',
      'product routes are wired to the service contract',
    );
    assert.equal((await request('/mcp', { method: 'POST', headers: auth })).status, 401);
    assert.equal(
      (await request('/app', { headers: { authorization: 'Bearer ' + token } })).status,
      302,
    );
    for (const path of [
      '/login',
      '/recover',
      '/settings/passkeys/add',
      '/settings/connected-apps',
    ]) {
      const response = await request(path, { headers: auth });
      assert.equal(response.status, 200, path);
      const document = await response.text();
      assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
      assert.equal(document, html.toString());
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    assert.equal((await request('/auth.js')).status, 404);
    assert.equal((await request('/settings/passkeys/add')).status, 302);
    assert.equal((await request('/settings/connected-apps')).status, 302);
    assert.equal((await request(assetPath)).status, 200);
    assert.equal(await (await request(assetPath)).text(), javascript.toString());
    assert.equal((await request('/unknown-page')).status, 404);
    assert.equal((await request('/assets/missing.js')).status, 404);
    assert.equal((await request('/api/unknown')).status, 401);
    assert.equal((await request('/api/unknown', { headers: auth })).status, 404);
    assert.deepEqual(await (await request('/api/status')).json(), { initialized: true });
    const mutation = { ...auth, Origin: origin, 'Content-Type': 'application/json' };
    for (const path of ['/auth/consent', '/api/grants/revoke']) {
      const invalid = await request(path, { method: 'POST', headers: mutation, body: 'null' });
      assert.equal(invalid.status, 400, path);
      assert.equal((await invalid.json()).error, 'invalid_request');
    }
    // Real FK/replay guards: expired completed and abandoned ceremonies can be pruned,
    // while an unexpired completed ceremony must retain its operation guard.
    const cutoff = Math.floor(Date.now() / 1000);
    const insertChallenge = (id, expires) =>
      db
        .prepare(
          'INSERT INTO webauthn_challenges (id,challenge,purpose,browser_digest,auth_epoch,canonical_origin,rp_id,expires_at) VALUES (?, ?, ?, ?, 3, ?, ?, ?)',
        )
        .bind(id, 'challenge', 'add', 'browser', origin, 'whiteboard.example', expires);
    const insertOperation = (id) =>
      db
        .prepare(
          'INSERT INTO auth_operations (id,purpose,challenge_id,browser_digest,auth_epoch,created_at) VALUES (?, ?, ?, ?, 3, ?)',
        )
        .bind('op-' + id, 'add', id, 'browser', cutoff);
    await db.batch([
      insertChallenge('expired-completed', cutoff + 300),
      insertOperation('expired-completed'),
      insertChallenge('active-completed', cutoff + 300),
      insertOperation('active-completed'),
    ]);
    await db
      .prepare("UPDATE webauthn_challenges SET expires_at=? WHERE id='expired-completed'")
      .bind(cutoff - 100)
      .run();
    await db.batch(
      Array.from({ length: 34 }, (_, i) => insertChallenge('abandoned-' + i, cutoff - 50)),
    );
    const loginOptions = () =>
      request('/auth/login/options', { method: 'POST', headers: mutation, body: '{}' });
    assert.equal((await loginOptions()).status, 200);
    assert.equal(
      (
        await db
          .prepare('SELECT count(*) AS n FROM webauthn_challenges WHERE expires_at<=?')
          .bind(cutoff)
          .first()
      ).n,
      3,
      'cleanup deletes at most 32 expired challenges',
    );
    assert.equal(
      await db
        .prepare("SELECT id FROM auth_operations WHERE challenge_id='expired-completed'")
        .first(),
      null,
    );
    assert.ok(
      await db
        .prepare("SELECT id FROM auth_operations WHERE challenge_id='active-completed'")
        .first(),
    );
    assert.equal((await loginOptions()).status, 200);
    assert.equal(
      (
        await db
          .prepare('SELECT count(*) AS n FROM webauthn_challenges WHERE expires_at<=?')
          .bind(cutoff)
          .first()
      ).n,
      0,
    );
    const operationReplay = insertOperation('active-completed');
    await assert.rejects(operationReplay.run(), /UNIQUE/);

    assert.equal(
      (await request('/api/preferences', { method: 'PUT', headers: mutation, body: '{' })).status,
      400,
    );
    assert.equal(
      (
        await request('/api/preferences', {
          method: 'PUT',
          headers: mutation,
          body: JSON.stringify({ huge: 'x'.repeat(16384) }),
        })
      ).status,
      413,
    );
    assert.equal(
      (
        await request('/api/preferences', {
          method: 'PUT',
          headers: { ...mutation, Origin: 'https://evil.example' },
          body: '{}',
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await request('/api/problems/p1/submissions?revision=0&edit_epoch=0', {
          method: 'POST',
          headers: {
            ...auth,
            Origin: origin,
            'Content-Type': 'image/png',
            'Idempotency-Key': 'test',
          },
          body: new Uint8Array(8 * 1024 * 1024 + 1),
        })
      ).status,
      413,
    );

    // The SPA obtains consent data from a protected API; SDK cookie/handle validation stays on the server.
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const redirectUri = 'http://127.0.0.1:8123/callback';
    const registration = await request('/oauth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: '<img src=x onerror=alert(1)>',
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      }),
    });
    assert.equal(registration.status, 201);
    const client = await registration.json();
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: client.client_id,
      redirect_uri: redirectUri,
      scope: 'mcp:read mcp:write',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      resource: origin + '/mcp',
      state: 'test-state',
    });
    const consentPage = await request('/authorize?' + query, { headers: auth });
    assert.equal(consentPage.status, 200);
    assert.equal(await consentPage.text(), html.toString());
    assert.equal((await request('/authorize?' + query)).status, 302);
    const prepare = (headers = mutation, requestQuery = query.toString()) =>
      request('/auth/consent', {
        method: 'POST',
        headers,
        body: JSON.stringify({ query: requestQuery }),
      });
    assert.equal(
      (await prepare({ Origin: origin, 'Content-Type': 'application/json' })).status,
      401,
    );
    assert.equal((await prepare({ ...mutation, Origin: 'https://evil.example' })).status, 403);
    assert.equal((await prepare(mutation, 'client_id=missing')).status, 400);
    const consent = await prepare();
    assert.equal(consent.status, 200);
    assert.match(consent.headers.get('content-type'), /application\/json/);
    const data = await consent.json();
    assert.equal(data.clientName, '<img src=x onerror=alert(1)>');
    assert.equal(data.redirectHost, '127.0.0.1');
    assert.ok(data.handle);
    const consentCookies = consent.headers
      .getSetCookie()
      .map((cookie) => cookie.split(';')[0])
      .join('; ');
    const missingRead = await request('/authorize', {
      method: 'POST',
      headers: { cookie: auth.cookie + '; ' + consentCookies, Origin: origin },
      body: new URLSearchParams({ handle: data.handle, scope: 'mcp:write', decision: 'approve' }),
    });
    assert.equal(missingRead.status, 400);
    assert.equal((await missingRead.json()).error, 'invalid_request');
    // A rejected scope selection must not consume the consent handle.
    const approved = await request('/authorize', {
      method: 'POST',
      headers: {
        cookie: auth.cookie + '; ' + consentCookies,
        Origin: origin,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams([
        ['handle', data.handle],
        ['scope', 'mcp:read'],
        ['decision', 'approve'],
      ]),
    });
    assert.equal(approved.status, 200);
    const callback = new URL((await approved.json()).redirectTo);
    assert.equal(callback.searchParams.get('state'), 'test-state');
    const exchange = await request('/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: callback.searchParams.get('code'),
        client_id: client.client_id,
        redirect_uri: redirectUri,
        code_verifier: verifier,
        resource: origin + '/mcp',
      }),
    });
    assert.equal(exchange.status, 200);
    const tokens = await exchange.json();
    assert.ok(tokens.access_token);
    const tools = await request('/mcp', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + tokens.access_token,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-11-25',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    assert.equal(tools.status, 200);
    assert.match(await tools.text(), /create_problems/);
    const callTool = (name, args) =>
      request('/mcp', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + tokens.access_token,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': '2025-11-25',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name, arguments: args },
        }),
      });
    const forbidden = await callTool('create_problems', {
      request_id: 'test',
      set_id: 's1',
      problems: [{ title: 'Test', body: 'Test' }],
    });
    assert.match(await forbidden.text(), /"error":"forbidden"/);
    const unimplemented = await callTool('list_problems', {});
    assert.match(await unimplemented.text(), /"error":"not_implemented"/);
    const csrfFailure = await request('/api/preferences', {
      method: 'PUT',
      headers: { ...mutation, Origin: 'https://evil.example' },
      body: '{}',
    });
    assert.equal(csrfFailure.status, 403);
    assert.equal((await csrfFailure.json()).error, 'forbidden');
    const replay = await request('/authorize', {
      method: 'POST',
      headers: { cookie: auth.cookie + '; ' + consentCookies, Origin: origin },
      body: new URLSearchParams({ handle: data.handle, decision: 'approve', scope: 'mcp:read' }),
    });
    assert.equal(replay.status, 400);
    const denialConsent = await prepare();
    const denialData = await denialConsent.json();
    const denialCookies = denialConsent.headers
      .getSetCookie()
      .map((cookie) => cookie.split(';')[0])
      .join('; ');
    const denied = await request('/authorize', {
      method: 'POST',
      headers: { cookie: auth.cookie + '; ' + denialCookies, Origin: origin },
      body: new URLSearchParams({ handle: denialData.handle, decision: 'deny' }),
    });
    assert.equal(denied.status, 200);
    assert.equal(
      new URL((await denied.json()).redirectTo).searchParams.get('error'),
      'access_denied',
    );
    assert.equal((await request('/.well-known/oauth-authorization-server')).status, 200);
    assert.equal((await request('/.well-known/oauth-protected-resource/mcp')).status, 200);
    const grants = await (await request('/api/grants', { headers: auth })).json();
    assert.equal(grants.items.length, 1);
    const emptyToken = await request('/oauth/token', { method: 'POST' });
    assert.equal(emptyToken.status, 400);
    const protocolError = await emptyToken.json();
    assert.ok(protocolError.error_description);
    assert.ok(protocolError.error);
    const largeToken = await request('/oauth/token', { method: 'POST', body: 'x'.repeat(65537) });
    assert.equal(largeToken.status, 413);
    assert.equal((await largeToken.json()).error, 'invalid_request');
    // Use a separate IP to exercise setup throttling independently of OAuth traffic.
    let limited;
    for (let i = 0; i < 61; i++)
      limited = await request('/setup', { headers: { 'CF-Connecting-IP': '192.0.2.42' } });
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).error, 'rate_limited');
    await db.prepare('UPDATE auth_state SET auth_epoch=4').run();
    assert.equal((await request('/api/me', { headers: auth })).status, 401);
    assert.equal((await request('/app', { headers: auth })).status, 302);
    assert.equal(
      (
        await request('/mcp', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + tokens.access_token,
            'Content-Type': 'application/json',
          },
          body: '{}',
        })
      ).status,
      401,
    );
  } finally {
    await mf.dispose();
  }
});

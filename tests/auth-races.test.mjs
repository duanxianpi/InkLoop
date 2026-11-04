import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { loadSource } from './load-source.mjs';
import { applyMigrations } from './migrations.mjs';
const require = createRequire(import.meta.url);
const { Miniflare, convertV4MiniflareOptions } = require(
  require.resolve('miniflare', { paths: [require.resolve('wrangler/package.json')] }),
);

// Interleavings that no sequence of whole requests can produce: the real password handlers run
// against a real local D1, and a recovery or password change is committed exactly between the
// password check and the write that acts on it. That write must then fail and change nothing.

crypto.subtle.timingSafeEqual ??= (a, b) => timingSafeEqual(a, b);
const { login, changePassword, state } = await loadSource(
  'src/server/auth/owner.ts',
  'src/server/auth/common.ts',
);

const origin = 'https://whiteboard.example';
const b64 = (bytes) => Buffer.from(bytes).toString('base64url');
const sha = (text) => b64(createHash('sha256').update(text).digest());
const derived = b64(randomBytes(32));

async function setup() {
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: 'export default { fetch() { return new Response(null) } }',
      d1Databases: ['DB'],
    }),
  );
  const db = await mf.getD1Database('DB');
  await applyMigrations(db);
  await db.prepare('INSERT INTO owner VALUES (1, unixepoch())').run();
  await db
    .prepare('UPDATE auth_state SET initialized_at=unixepoch(), canonical_origin=?, auth_epoch=1')
    .bind(origin)
    .run();
  await db
    .prepare("INSERT INTO owner_password VALUES (1, 'salt', 600000, ?, unixepoch())")
    .bind(sha(derived))
    .run();
  const token = b64(randomBytes(32));
  await db
    .prepare('INSERT INTO web_sessions VALUES (?, 1, 1, unixepoch()+3600, unixepoch())')
    .bind(sha(token))
    .run();
  const user = { owner_id: 1, auth_epoch: 1, created_at: 0, digest: sha(token) };
  /** env whose D1 runs `between` right after the first batch: the password check's read. */
  const env = (between) => {
    let first = true;
    return {
      DB: {
        prepare: (sql) => db.prepare(sql),
        batch: async (statements) => {
          const results = await db.batch(statements);
          if (first && between) {
            first = false;
            await between();
          }
          return results;
        },
      },
    };
  };
  const post = (path, body) =>
    new Request(origin + path, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const count = async (table) => (await db.prepare(`SELECT COUNT(*) n FROM ${table}`).first()).n;
  return { mf, db, env, post, user, count };
}

const recovery = (db) => () =>
  db.batch([
    db.prepare('UPDATE auth_state SET auth_epoch = auth_epoch + 1'),
    db.prepare('DELETE FROM web_sessions'),
    db.prepare("UPDATE owner_password SET verifier = 'recovered'"),
  ]);
const passwordChange = (db) => () =>
  db.prepare("UPDATE owner_password SET verifier = 'changed'").run();

test('a sign-in checked before a recovery or password change gets no session', async () => {
  const { mf, db, env, post, count } = await setup();
  try {
    for (const between of [recovery(db), passwordChange(db)]) {
      await db.prepare('DELETE FROM web_sessions').run();
      await db.prepare('UPDATE owner_password SET verifier = ?').bind(sha(derived)).run();
      const s = await state(env());
      await assert.rejects(
        login(post('/auth/login', { derived }), env(between), s),
        (error) => error.status === 401,
      );
      assert.equal(await count('web_sessions'), 0, 'no session was issued');
    }
    // Without an interleaving the same request signs in.
    await db.prepare('UPDATE owner_password SET verifier = ?').bind(sha(derived)).run();
    const response = await login(post('/auth/login', { derived }), env(), await state(env()));
    assert.equal(response.status, 200);
    assert.equal(await count('web_sessions'), 1);
  } finally {
    await mf.dispose();
  }
});

test('a password change loses to a concurrent change and needs a live session', async () => {
  const { mf, db, env, post, user } = await setup();
  try {
    const next = { salt: b64(randomBytes(16)), iterations: 600000, derived: b64(randomBytes(32)) };
    const body = { current: derived, password: next };
    const verifier = async () =>
      (await db.prepare('SELECT verifier FROM owner_password').first()).verifier;
    const s = await state(env());

    // Another change commits between the check and this write: this one must not overwrite it.
    await assert.rejects(
      changePassword(post('/auth/password', body), env(passwordChange(db)), s, user),
      (error) => error.status === 401,
    );
    assert.equal(await verifier(), 'changed');

    // The caller's session ends (sign-out elsewhere) in between: the change is refused.
    await db.prepare('UPDATE owner_password SET verifier = ?').bind(sha(derived)).run();
    const signOut = () =>
      db.prepare('DELETE FROM web_sessions WHERE digest = ?').bind(user.digest).run();
    await assert.rejects(
      changePassword(post('/auth/password', body), env(signOut), s, user),
      (error) => error.status === 401,
    );
    assert.equal(await verifier(), sha(derived));
  } finally {
    await mf.dispose();
  }
});

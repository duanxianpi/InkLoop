import { boundedJsonObject } from '../http/body';
import { LIMITS } from '../../shared/limits';
import { PASSWORD_KDF, type PasswordParams } from '../../shared/auth';
import {
  assert,
  csrf,
  digest,
  HttpError,
  json,
  now,
  random,
  setCookie,
  type Env,
  type OwnerSession,
  type State,
} from './common';

// Owner password sign-in. The browser stretches the password with PBKDF2-SHA256 (salt and
// iterations below); the Worker stores and compares only SHA-256 of the stretched value, so a
// sign-in costs one hash of Worker CPU. A leaked verifier still costs a full PBKDF2 per guess.
// Setup needs the deployment's claim key and recovery needs the recovery key, both read from D1.

const SESSION_SECONDS = 604800;
/** Failed sign-ins before delays start; the delay starts at 2 seconds and doubles, up to 15 minutes. */
const FREE_ATTEMPTS = 5;
const MAX_DELAY_SECONDS = 900;

export async function ensureBootstrap(env: Env) {
  const key = random();
  await env.DB.prepare(
    "INSERT INTO admin_keys (purpose,secret_display,secret_digest,generation,created_at) SELECT 'bootstrap',?,?,1,? WHERE (SELECT initialized_at FROM auth_state WHERE id=1) IS NULL ON CONFLICT(purpose) DO NOTHING",
  )
    .bind(key, await digest(key), now())
    .run();
}

async function proof(env: Env, purpose: 'bootstrap' | 'recovery', key: unknown) {
  assert(
    typeof key === 'string' && /^[A-Za-z0-9_-]{43}$/.test(key),
    403,
    'Invalid claim or recovery key',
  );
  const hash = await digest(key);
  const record = await env.DB.prepare(
    'SELECT generation FROM admin_keys WHERE purpose=? AND secret_digest=? AND consumed_at IS NULL',
  )
    .bind(purpose, hash)
    .first<{ generation: number }>();
  assert(record, 403, 'Invalid claim or recovery key');
  return { hash, generation: record.generation };
}

function confirmedOrigin(value: unknown, request: Request) {
  assert(typeof value === 'string', 400, 'Confirm canonical HTTPS origin');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new HttpError(400, 'Invalid origin');
  }
  assert(
    url.protocol === 'https:' &&
      url.origin === value &&
      url.origin === new URL(request.url).origin &&
      !url.username &&
      !url.password &&
      !url.port,
    400,
    'Confirm the exact HTTPS origin shown in your browser',
  );
  return { origin: value, host: url.hostname };
}

/** base64url of the 32-byte PBKDF2 output. */
function derivedValue(value: unknown): string {
  assert(typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value), 400, 'Invalid password');
  return value;
}

/** A new password: its own random salt, at least the current iteration count. */
async function newPassword(value: unknown) {
  assert(
    value !== null && typeof value === 'object' && !Array.isArray(value),
    400,
    'Invalid password',
  );
  const { salt, iterations, derived } = value as Record<string, unknown>;
  assert(
    typeof salt === 'string' &&
      /^[A-Za-z0-9_-]{22,86}$/.test(salt) &&
      Number.isSafeInteger(iterations) &&
      (iterations as number) >= PASSWORD_KDF.minIterations &&
      (iterations as number) <= PASSWORD_KDF.maxIterations,
    400,
    'Invalid password parameters',
  );
  return { salt, iterations: iterations as number, verifier: await digest(derivedValue(derived)) };
}

async function same(a: string, b: string) {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  // workerd's constant-time comparison; the DOM typings shadow it.
  const subtle = crypto.subtle as unknown as {
    timingSafeEqual(a: ArrayBufferView, b: ArrayBufferView): boolean;
  };
  return left.byteLength === right.byteLength && subtle.timingSafeEqual(left, right);
}

/**
 * Run `statements` as one transaction, guarded by the auth epoch and `condition` (see
 * migrations/0004_product.sql): false when the condition was no longer true at commit time.
 */
async function guarded(
  env: Env,
  authEpoch: number,
  condition: string,
  binds: unknown[],
  statements: D1PreparedStatement[],
) {
  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO write_guards (auth_epoch, ok) VALUES (?, (${condition}))`).bind(
        authEpoch,
        ...binds,
      ),
      ...statements,
      env.DB.prepare('DELETE FROM write_guards'),
    ]);
    return true;
  } catch (error) {
    if (/precondition_failed|auth_epoch_changed|UNIQUE constraint/.test(String(error)))
      return false;
    throw error;
  }
}

/** A new Web session row, bound to the auth epoch current when the batch commits. */
async function newSession(env: Env, t: number) {
  const token = random();
  return {
    cookie: setCookie('__Host-owner', token, SESSION_SECONDS),
    statement: env.DB.prepare(
      'INSERT INTO web_sessions SELECT ?,1,auth_epoch,?,? FROM auth_state WHERE id=1',
    ).bind(await digest(token), t + SESSION_SECONDS, t),
  };
}

const resetThrottle = (env: Env) =>
  env.DB.prepare('UPDATE login_throttle SET failures=0, retry_after=0 WHERE id=1');

const storePassword = (env: Env, password: Awaited<ReturnType<typeof newPassword>>, t: number) =>
  env.DB.prepare(
    'INSERT INTO owner_password VALUES (1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET salt=excluded.salt, iterations=excluded.iterations, verifier=excluded.verifier, updated_at=excluded.updated_at',
  ).bind(password.salt, password.iterations, password.verifier, t);

/**
 * Check a stretched password against the stored one, with delays after repeated failures.
 * Returns the verifier that matched; the write that acts on the check must require it unchanged
 * (`SAME_PASSWORD`), so a recovery or password change in between makes that write fail.
 */
async function checkPassword(env: Env, derived: string): Promise<string> {
  const t = now();
  const [throttle, stored] = await env.DB.batch<never>([
    env.DB.prepare('SELECT failures, retry_after FROM login_throttle WHERE id=1'),
    env.DB.prepare('SELECT verifier FROM owner_password WHERE id=1'),
  ]);
  const { retry_after } = throttle.results[0] as unknown as { retry_after: number };
  if (retry_after > t)
    throw new HttpError(
      429,
      `Too many incorrect passwords. Try again in ${retry_after - t} seconds.`,
      'rate_limited',
    );
  const row = stored.results[0] as unknown as { verifier: string } | undefined;
  if (!row)
    throw new HttpError(
      409,
      'No password is set yet. Set one with your recovery key.',
      'password_not_set',
    );
  if (await same(await digest(derived), row.verifier)) return row.verifier;
  await env.DB.prepare(
    `UPDATE login_throttle SET failures = failures + 1,
       retry_after = CASE WHEN failures + 1 >= ?1 THEN ?2 + MIN(?3, 2 << MIN(9, failures + 1 - ?1)) ELSE 0 END
     WHERE id = 1`,
  )
    .bind(FREE_ATTEMPTS, t, MAX_DELAY_SECONDS)
    .run();
  throw new HttpError(401, 'Incorrect password');
}

const SAME_PASSWORD = '(SELECT verifier FROM owner_password WHERE id=1) = ?';

async function body(request: Request, s: State) {
  const data = await boundedJsonObject(request, LIMITS.authRequestBytes);
  csrf(request, s.canonical_origin ?? new URL(request.url).origin);
  return data;
}

/** Public: the salt and iteration count the browser needs to stretch the password. */
export async function passwordParams(env: Env, s: State) {
  assert(s.initialized_at, 409, 'Not set up yet');
  const row = await env.DB.prepare(
    'SELECT salt, iterations FROM owner_password WHERE id=1',
  ).first<PasswordParams>();
  if (!row)
    throw new HttpError(
      409,
      'No password is set yet. Set one with your recovery key.',
      'password_not_set',
    );
  return json(row);
}

/** First setup: claim key, permanent origin and the owner's password, in one transaction. */
export async function setup(request: Request, env: Env, s: State) {
  const data = await body(request, s);
  assert(!s.initialized_at, 409, 'Already set up');
  const claim = await proof(env, 'bootstrap', data.key);
  const { origin, host } = confirmedOrigin(data.canonicalOrigin, request);
  const password = await newPassword(data.password);
  const t = now();
  const recovery = random();
  const session = await newSession(env, t);
  const ok = await guarded(
    env,
    s.auth_epoch,
    "(SELECT initialized_at FROM auth_state WHERE id=1) IS NULL AND EXISTS (SELECT 1 FROM admin_keys WHERE purpose='bootstrap' AND secret_digest=? AND generation=? AND consumed_at IS NULL)",
    [claim.hash, claim.generation],
    [
      env.DB.prepare('INSERT INTO owner VALUES (1,?)').bind(t),
      storePassword(env, password, t),
      env.DB.prepare(
        'UPDATE auth_state SET initialized_at=?,canonical_origin=?,rp_id=? WHERE id=1',
      ).bind(t, origin, host),
      env.DB.prepare(
        "UPDATE admin_keys SET secret_display=NULL,consumed_at=? WHERE purpose='bootstrap'",
      ).bind(t),
      env.DB.prepare("INSERT INTO admin_keys VALUES ('recovery',?,?,1,NULL,?)").bind(
        recovery,
        await digest(recovery),
        t,
      ),
      resetThrottle(env),
      session.statement,
    ],
  );
  assert(ok, 409, 'Setup was already completed or the claim key changed');
  return json({ ok: true }, 200, { 'Set-Cookie': session.cookie });
}

export async function login(request: Request, env: Env, s: State) {
  const data = await body(request, s);
  assert(s.initialized_at, 409, 'Not set up yet');
  const verifier = await checkPassword(env, derivedValue(data.derived));
  const t = now();
  const session = await newSession(env, t);
  // The session is issued only if the epoch the request started under and the password it was
  // checked against are both still current when it commits.
  const ok = await guarded(
    env,
    s.auth_epoch,
    SAME_PASSWORD,
    [verifier],
    [resetThrottle(env), session.statement],
  );
  assert(ok, 401, 'The password changed while signing in; sign in again');
  return json({ ok: true }, 200, { 'Set-Cookie': session.cookie });
}

/**
 * Recovery sets a new password and starts over: the auth epoch advances, so every Web session and
 * MCP authorization from before stops working, and the recovery key is replaced.
 */
export async function recover(request: Request, env: Env, s: State) {
  const data = await body(request, s);
  assert(s.initialized_at, 409, 'Not set up yet');
  const key = await proof(env, 'recovery', data.key);
  const password = await newPassword(data.password);
  const t = now();
  const replacement = random();
  const session = await newSession(env, t);
  const ok = await guarded(
    env,
    s.auth_epoch,
    "EXISTS (SELECT 1 FROM admin_keys WHERE purpose='recovery' AND secret_digest=? AND generation=? AND consumed_at IS NULL)",
    [key.hash, key.generation],
    [
      storePassword(env, password, t),
      env.DB.prepare('UPDATE auth_state SET auth_epoch=auth_epoch+1 WHERE id=1'),
      env.DB.prepare('DELETE FROM web_sessions'),
      env.DB.prepare(
        "UPDATE admin_keys SET secret_display=?,secret_digest=?,generation=generation+1,created_at=? WHERE purpose='recovery'",
      ).bind(replacement, await digest(replacement), t),
      resetThrottle(env),
      session.statement,
    ],
  );
  assert(ok, 409, 'The recovery key was already used or authorization changed');
  if (env.OAUTH_PROVIDER) {
    try {
      let cursor: string | undefined;
      do {
        const page = await env.OAUTH_PROVIDER.listUserGrants('1', { cursor });
        for (const grant of page.items) await env.OAUTH_PROVIDER.revokeGrant(grant.id, '1');
        cursor = page.cursor;
      } while (cursor);
    } catch {
      console.warn('oauth_grant_cleanup_deferred');
    }
  }
  return json({ ok: true }, 200, { 'Set-Cookie': session.cookie });
}

/** Change the password; other Web sessions end, connected AI apps keep working. */
export async function changePassword(request: Request, env: Env, s: State, user: OwnerSession) {
  const data = await body(request, s);
  const verifier = await checkPassword(env, derivedValue(data.current));
  const password = await newPassword(data.password);
  const t = now();
  // The checked password must still be current (a concurrent change loses) and the caller's own
  // session must still exist at commit time.
  const ok = await guarded(
    env,
    user.auth_epoch,
    `${SAME_PASSWORD} AND EXISTS (SELECT 1 FROM web_sessions WHERE digest=? AND auth_epoch=? AND expires_at>?)`,
    [verifier, user.digest, user.auth_epoch, t],
    [
      storePassword(env, password, t),
      env.DB.prepare('DELETE FROM web_sessions WHERE digest != ?').bind(user.digest),
      resetThrottle(env),
    ],
  );
  assert(ok, 401, 'The password or this session changed; sign in again');
  return json({ ok: true });
}

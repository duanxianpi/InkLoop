import { AuthorizationError, CimdFetchError } from '@cloudflare/workers-oauth-provider';
import { assert, json, now, random, type Env, type OwnerSession } from './common';
import { boundedJsonObject, boundedText } from '../http/body';
import { LIMITS } from '../../shared/limits';
import type { ConsentData } from '../../shared/auth';

/** Parse only server-validated OAuth context; the client never selects its own redirect destination. */
export async function prepareConsent(request: Request, env: Env, origin: string) {
  const data = (await boundedJsonObject(request, LIMITS.authRequestBytes)) as any;
  assert(
    typeof data.query === 'string' && data.query.length <= 16384,
    400,
    'Invalid authorization query',
  );
  const url = new URL('/authorize', origin);
  url.search = data.query;
  let authRequest;
  try {
    authRequest = await env.OAUTH_PROVIDER.parseAuthRequest(new Request(url));
  } catch (error) {
    return consentError(error, url, origin);
  }
  const detail = await env.OAUTH_PROVIDER.describeConsent(authRequest);
  const consent = await env.OAUTH_PROVIDER.beginConsent(authRequest);
  const result: ConsentData = {
    clientName: detail.clientName,
    clientDomain: detail.clientDomain ?? null,
    redirectHost: detail.redirectHost,
    redirectIsLoopback: detail.redirectIsLoopback,
    resource: origin + '/mcp',
    scopes: detail.scope,
    handle: consent.handle,
  };
  return json(result, 200, consent.headers);
}

/**
 * An authorization request the page cannot show, explained by cause. `redirectTo`, present once the
 * client and its redirect URI were validated, returns the error to the app (RFC 6749 §4.1.2.1).
 * Only request parameters are echoed; no credential is part of an authorization request.
 */
function consentError(error: unknown, url: URL, origin: string) {
  if (error instanceof CimdFetchError)
    return json(
      {
        error: 'client_metadata_unavailable',
        message: `Couldn't load this app's registration from ${error.metadataUrl}. Try connecting again; if it keeps failing, the app's client metadata is unavailable.`,
      },
      400,
    );
  if (!(error instanceof AuthorizationError)) throw error;
  const resources = [...new Set(url.searchParams.getAll('resource'))];
  const message =
    error.code === 'invalid_target'
      ? `This app asked for access to ${resources.join(' and ') || 'an unspecified resource'}, which this server doesn't host. InkLoop's MCP resource is ${origin}/mcp: check the MCP URL configured in the app.`
      : error.description === 'Invalid redirect URI'
        ? "The app's redirect address isn't registered for this app, so the request was refused."
        : error.description === 'Invalid client_id' || error.description === 'client_id is required'
          ? "The app didn't identify itself with a known client ID, so the request was refused."
          : `The app sent an authorization request this server can't accept: ${error.description}.`;
  return json(
    { error: error.code, message, ...(error.redirectTo ? { redirectTo: error.redirectTo } : {}) },
    400,
  );
}

export async function submitConsent(request: Request, env: Env, user: OwnerSession) {
  const form = new URLSearchParams(await boundedText(request, LIMITS.authRequestBytes));
  const handle = String(form.get('handle') ?? '');
  if (form.get('decision') !== 'approve') {
    const denied = await env.OAUTH_PROVIDER.denyConsent(request, handle);
    denied.headers.delete('Location');
    return json({ redirectTo: denied.redirectTo }, 200, denied.headers);
  }
  const scopes = form.getAll('scope').map(String);
  assert(scopes.includes('mcp:read'), 400, 'mcp:read is required to connect this application');
  const approved = await env.OAUTH_PROVIDER.approveConsent(request, handle, { scope: scopes });
  const authorizationId = random();
  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: approved.request,
    userId: '1',
    metadata: { authorizationId },
    scope: approved.request.scope,
    props: { ownerId: 1, authEpoch: user.auth_epoch, authorizationId },
  });
  const indexed = await env.DB.prepare(
    'INSERT INTO connected_apps SELECT ?,?,?,?,? WHERE (SELECT auth_epoch FROM auth_state WHERE id=1)=?',
  )
    .bind(
      authorizationId,
      approved.request.clientId,
      JSON.stringify(approved.request.scope),
      user.auth_epoch,
      now(),
      user.auth_epoch,
    )
    .run();
  assert(indexed.meta.changes === 1, 401, 'Authorization changed; sign in again');
  return json({ redirectTo }, 200, approved.headers);
}

export async function listGrants(request: Request, env: Env, user: OwnerSession) {
  const url = new URL(request.url);
  const after = url.searchParams.get('cursor') ?? '';
  const rows = (
    await env.DB.prepare(
      'SELECT authorization_id,client_id,scope,created_at FROM connected_apps WHERE auth_epoch=? AND authorization_id>? AND NOT EXISTS (SELECT 1 FROM oauth_revocations WHERE authorization_id=connected_apps.authorization_id) ORDER BY authorization_id LIMIT 51',
    )
      .bind(user!.auth_epoch, after)
      .all<any>()
  ).results;
  return json({
    items: rows.slice(0, 50).map((row) => ({
      id: row.authorization_id,
      clientId: row.client_id,
      scope: JSON.parse(row.scope),
      createdAt: row.created_at,
    })),
    ...(rows.length > 50 ? { cursor: rows[49].authorization_id } : {}),
  });
}

export async function revokeGrant(request: Request, env: Env, user: OwnerSession) {
  assert(user!.created_at > now() - 300, 401, 'Reauthentication required');
  const data = (await boundedJsonObject(request, LIMITS.authRequestBytes)) as any;
  assert(typeof data.grantId === 'string');
  const selected = await env.DB.prepare(
    'SELECT authorization_id FROM connected_apps WHERE authorization_id=? AND auth_epoch=?',
  )
    .bind(data.grantId, user!.auth_epoch)
    .first<{ authorization_id: string }>();
  assert(selected, 404, 'Grant not found');
  await env.DB.prepare('INSERT OR IGNORE INTO oauth_revocations VALUES (?,?)')
    .bind(selected.authorization_id, now())
    .run();
  // D1 is authoritative immediately. Best-effort SDK cleanup must not delay revocation.
  try {
    let cursor: string | undefined;
    do {
      const grants = await env.OAUTH_PROVIDER.listUserGrants('1', { cursor });
      for (const grant of grants.items)
        if (grant.metadata?.authorizationId === selected.authorization_id)
          await env.OAUTH_PROVIDER.revokeGrant(grant.id, '1');
      cursor = grants.cursor;
    } while (cursor);
  } catch {
    console.warn('oauth_grant_cleanup_deferred');
  }
  return json({ ok: true });
}

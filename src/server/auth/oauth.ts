import {
  OAuthProvider,
  OAuthError,
  getOAuthApi,
  insufficientScope,
  type OAuthProviderOptions,
  type OAuthResourceContext,
} from '@cloudflare/workers-oauth-provider';
import { assert, json, type Env, type State } from './common';
import type { GrantProps, McpIdentity } from './types';

export type AuthenticatedHandler = (request: Request, owner: McpIdentity) => Promise<Response>;

/** Reuse the state read for this request; no cross-request authorization cache. */
async function validGrant(env: Env, props: unknown, current: State) {
  const grant = props as Partial<GrantProps> | null;
  if (
    grant?.ownerId !== 1 ||
    grant.authEpoch !== current.auth_epoch ||
    !current.initialized_at ||
    typeof grant.authorizationId !== 'string'
  )
    return false;
  return !(await env.DB.prepare('SELECT 1 FROM oauth_revocations WHERE authorization_id=?')
    .bind(grant.authorizationId)
    .first());
}

function configuration(current: State, handler?: AuthenticatedHandler): OAuthProviderOptions<Env> {
  const origin = current.canonical_origin!;
  return {
    apiRoute: origin + '/mcp',
    apiHandler: {
      async fetch(request, env, context) {
        const ctx = context as OAuthResourceContext<GrantProps>;
        if (!(await validGrant(env, ctx.props, current)))
          return json({ error: 'invalid_token' }, 401, {
            'WWW-Authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", error="invalid_token", scope="mcp:read mcp:write"`,
          });
        if (!ctx.auth.scope.includes('mcp:read')) return insufficientScope(ctx.auth, ['mcp:read']);
        if (!handler) return json({ error: 'not_found' }, 404);
        return handler(request, {
          ownerId: ctx.props.ownerId,
          authEpoch: ctx.props.authEpoch,
          scopes: ctx.auth.scope,
          requireScope(scope) {
            assert(
              ctx.auth.scope.includes(scope),
              403,
              `This app was connected with read-only access (${scope} was not granted). Reconnect it and allow write access on the consent page to use this tool.`,
            );
          },
        });
      },
    },
    defaultHandler: { fetch: () => json({ error: 'not_found' }, 404) },
    authorizeEndpoint: origin + '/authorize',
    tokenEndpoint: origin + '/oauth/token',
    clientRegistrationEndpoint: origin + '/oauth/register',
    clientIdMetadataDocumentEnabled: true,
    scopesSupported: ['mcp:read', 'mcp:write', 'offline_access'],
    // Advertised in resource metadata and the 401 challenge, so MCP clients request both by
    // default (they request what the resource advertises). Only mcp:read is enforced for every
    // request; the owner may still grant read-only access on the consent page.
    requiredScopes: ['mcp:read', 'mcp:write'],
    resourceMetadata: { resource: origin + '/mcp', authorization_servers: [origin] },
    accessTokenTTL: 300,
    refreshTokenTTL: 2592000,
    tokenExchangeCallback: async ({ props, env }) => {
      if (!(await validGrant(env, props, current)))
        throw new OAuthError('invalid_grant', {
          description: 'Owner authorization is no longer valid',
        });
    },
    onError: ({ code, description, status, headers }) =>
      json({ error: code, error_description: description }, status, headers),
  };
}

export function withOAuth<E extends Env>(env: E, current: State): E {
  return { ...env, OAUTH_PROVIDER: getOAuthApi(configuration(current), env) };
}

/** Hono injects the product handler; authentication has no product imports. */
export function handleOAuth(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  current: State,
  handler: AuthenticatedHandler,
) {
  return new OAuthProvider(configuration(current, handler)).fetch(request, env, ctx);
}

import {
  OAuthProvider,
  OAuthError,
  getOAuthApi,
  insufficientScope,
  type OAuthProviderOptions,
  type OAuthResourceContext,
} from '@cloudflare/workers-oauth-provider';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { assert, json, state } from './common';
import { appContext, type Env } from '../env';
import { createServices } from '../services';
import { registerWhiteboardTools } from '../mcp/tools';
import { LIMITS } from '../../shared/limits';
import type { GrantProps } from './types';

async function validGrant(env: Env, props: any) {
  const current = await state(env);
  if (
    props?.ownerId !== 1 ||
    props?.authEpoch !== current.auth_epoch ||
    !current.initialized_at ||
    typeof props.authorizationId !== 'string'
  )
    return false;
  return !(await env.DB.prepare('SELECT 1 FROM oauth_revocations WHERE authorization_id=?')
    .bind(props.authorizationId)
    .first());
}
async function mcp(request: Request, env: Env, ctx: OAuthResourceContext<GrantProps>) {
  if (!(await validGrant(env, ctx.props)))
    return json({ error: 'invalid_token' }, 401, {
      'WWW-Authenticate': `Bearer resource_metadata="${(await state(env)).canonical_origin}/.well-known/oauth-protected-resource/mcp", error="invalid_token"`,
    });
  if (!ctx.auth.scope.includes('mcp:read')) return insufficientScope(ctx.auth, ['mcp:read']);
  const handler = createMcpHandler(
    () => {
      const server = new McpServer({ name: 'agent-whiteboard', version: '0.1.0' });
      registerWhiteboardTools(server, createServices(appContext(env, ctx.props.authEpoch)), {
        ownerId: ctx.props.ownerId,
        authEpoch: ctx.props.authEpoch,
        scopes: ctx.auth.scope,
        requireScope(scope) {
          assert(ctx.auth.scope.includes(scope), 403, 'Missing ' + scope + ' scope');
        },
      });
      return server;
    },
    { legacy: 'stateless', maxRequestBodySize: LIMITS.mcpRequestBytes },
  );
  return handler.fetch(request);
}
function configuration(origin: string): OAuthProviderOptions<Env> {
  return {
    apiRoute: origin + '/mcp',
    apiHandler: {
      fetch: (request, env, ctx) => mcp(request, env, ctx as OAuthResourceContext<GrantProps>),
    },
    defaultHandler: { fetch: () => json({ error: 'not_found' }, 404) },
    authorizeEndpoint: origin + '/authorize',
    tokenEndpoint: origin + '/oauth/token',
    clientRegistrationEndpoint: origin + '/oauth/register',
    clientIdMetadataDocumentEnabled: true,
    scopesSupported: ['mcp:read', 'mcp:write', 'offline_access'],
    requiredScopes: ['mcp:read'],
    resourceMetadata: { resource: origin + '/mcp', authorization_servers: [origin] },
    accessTokenTTL: 300,
    refreshTokenTTL: 2592000,
    tokenExchangeCallback: async ({ props, env }) => {
      if (!(await validGrant(env, props)))
        throw new OAuthError('invalid_grant', {
          description: 'Owner authorization is no longer valid',
        });
    },
    onError: ({ code, description, status, headers }) =>
      json({ error: code, error_description: description }, status, headers),
  };
}

/** Helpers for app-owned consent, recovery and revocation routes. No routing occurs here. */
export function withOAuth(env: Env, origin: string): Env {
  return { ...env, OAUTH_PROVIDER: getOAuthApi(configuration(origin), env) };
}

/** Only protocol-owned routes are forwarded to the SDK by Hono. */
export function handleOAuth(request: Request, env: Env, ctx: ExecutionContext, origin: string) {
  return new OAuthProvider(configuration(origin)).fetch(request, env, ctx);
}

import type { McpIdentity } from '../auth/types';
import { boundedText } from '../http/body';
import { HttpError } from '../http/errors';
import type { Services } from '../services';
import { LIMITS } from '../../shared/limits';
import { TOOL_LIST } from './tools.generated';
import { callTool, isToolName } from './tools';

// Hand-rolled MCP endpoint: stateless Streamable HTTP, protocol version 2025-11-25.
//
// It implements only what four synchronous tools need, so a request runs a few small functions
// instead of the SDK's transport, session and schema machinery (CPU figures: docs/performance.md).
// Deliberately absent: SSE streams, sessions (Mcp-Session-Id), JSON-RPC batches, server-to-client
// requests, and every capability other than tools. Unsupported methods get "method not found".
// OAuth, bearer tokens and scopes are checked before this runs (src/server/auth/oauth.ts).

/**
 * 2025-11-25 is the target. 2025-06-18 is accepted too: for tools-only stateless use the two are
 * identical on the wire, and some clients still request it.
 */
const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18'];
const SERVER_INFO = { name: 'inkloop', version: '0.1.0' };

// JSON-RPC 2.0 error codes.
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;
/** Transport-level rejection; the code the SDK used for the same HTTP errors. */
const SERVER_ERROR = -32000;

type Id = string | number;

const reply = (body: unknown, status = 200, headers?: Record<string, string>) =>
  Response.json(body, { status, headers });
const result = (id: Id, value: unknown) => reply({ jsonrpc: '2.0', id, result: value });
const error = (id: Id | null, code: number, message: string, status = 200) =>
  reply({ jsonrpc: '2.0', id, error: { code, message } }, status);

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export async function handleMcp(
  request: Request,
  owner: McpIdentity,
  services: () => Services,
): Promise<Response> {
  // Clients POST every message. GET (a server-push SSE stream) and DELETE (ending a session) only
  // exist for features this server does not offer, so 405 is the spec's answer to both.
  if (request.method !== 'POST')
    return reply(
      { jsonrpc: '2.0', id: null, error: { code: SERVER_ERROR, message: 'Method not allowed' } },
      405,
      { Allow: 'POST' },
    );

  // Clients send the negotiated version on every request after initialize. A missing header is
  // allowed (initialize itself has none); an unknown one is rejected as the spec requires.
  const version = request.headers.get('MCP-Protocol-Version');
  if (version !== null && !PROTOCOL_VERSIONS.includes(version))
    return error(null, SERVER_ERROR, 'Unsupported protocol version: ' + version, 400);

  if (
    request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json'
  )
    return error(null, SERVER_ERROR, 'Content-Type must be application/json', 415);

  let message: unknown;
  try {
    message = JSON.parse(await boundedText(request, LIMITS.mcpRequestBytes));
  } catch (cause) {
    if (cause instanceof HttpError) return error(null, SERVER_ERROR, cause.message, cause.status);
    return error(null, PARSE_ERROR, 'Parse error', 400);
  }

  if (Array.isArray(message))
    return error(null, INVALID_REQUEST, 'Batch requests are not supported', 400);
  if (!isObject(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string')
    return error(null, INVALID_REQUEST, 'Invalid request', 400);

  // A message without an id is a notification (initialized, cancelled, ...). Nothing here has
  // state for one to change, so all are acknowledged and ignored.
  if (!('id' in message)) return new Response(null, { status: 202 });
  const id = message.id;
  if (typeof id !== 'string' && (typeof id !== 'number' || !Number.isFinite(id)))
    return error(null, INVALID_REQUEST, 'Invalid request id', 400);
  const params = message.params === undefined ? {} : message.params;
  if (!isObject(params)) return error(id, INVALID_PARAMS, 'params must be an object');

  try {
    switch (message.method) {
      case 'initialize': {
        if (
          typeof params.protocolVersion !== 'string' ||
          !isObject(params.capabilities) ||
          !isObject(params.clientInfo) ||
          typeof params.clientInfo.name !== 'string' ||
          typeof params.clientInfo.version !== 'string'
        )
          return error(id, INVALID_PARAMS, 'Invalid initialization parameters');
        // Version negotiation: echo the client's version if supported, otherwise offer ours.
        // Being stateless, nothing is remembered; every later request stands on its own.
        const requested = params.protocolVersion;
        return result(id, {
          protocolVersion: PROTOCOL_VERSIONS.includes(requested as string)
            ? requested
            : PROTOCOL_VERSIONS[0],
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        });
      }
      case 'ping':
        return result(id, {});
      case 'tools/list':
        // Generated at build time from the zod schemas; four tools, so no pagination.
        return result(id, { tools: TOOL_LIST });
      case 'tools/call': {
        // An unknown tool is a protocol error; anything wrong after that is a tool result.
        if (!isToolName(params.name))
          return error(id, INVALID_PARAMS, 'Unknown tool: ' + String(params.name));
        const args = params.arguments === undefined ? {} : params.arguments;
        return result(id, await callTool(params.name, args, owner, services));
      }
      default:
        return error(id, METHOD_NOT_FOUND, 'Method not found');
    }
  } catch (cause) {
    // callTool already converts tool failures; reaching here means a bug in this file.
    console.error('mcp_internal_error', (cause as Error)?.name);
    return error(id, INTERNAL_ERROR, 'Internal error');
  }
}

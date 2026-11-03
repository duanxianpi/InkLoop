import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import type { McpIdentity } from '../auth/types';
import { appContext, type Env } from '../env';
import { createServices } from '../services';
import { LIMITS } from '../../shared/limits';
import { registerWhiteboardTools } from './tools';

export function handleMcp(request: Request, env: Env, owner: McpIdentity) {
  const handler = createMcpHandler(
    () => {
      const server = new McpServer({ name: 'agent-whiteboard', version: '0.1.0' });
      registerWhiteboardTools(server, createServices(appContext(env, owner.authEpoch)), owner);
      return server;
    },
    { legacy: 'stateless', maxRequestBodySize: LIMITS.mcpRequestBytes },
  );
  return handler.fetch(request);
}

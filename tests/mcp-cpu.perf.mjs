import test from 'node:test';
import { loadSource } from './load-source.mjs';

// Diagnostic Node CPU samples, not Cloudflare CPU or independent cold isolates.
const { handleMcp } = await loadSource('src/server/mcp/handler.ts');
const owner = { ownerId: 1, authEpoch: 1, scopes: ['mcp:read', 'mcp:write'], requireScope() {} };
const services = { problems: { create: async () => ({ set_id: 's1', problem_ids: [] }) } };

/** Main-thread CPU only, so V8's background compiler threads are not counted. */
function cpuMs() {
  const usage = process.threadCpuUsage?.() ?? process.cpuUsage();
  return (usage.user + usage.system) / 1000;
}

async function measure(body) {
  const request = new Request('https://example.test/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'MCP-Protocol-Version': '2025-11-25' },
    body: JSON.stringify(body),
  });
  const start = cpuMs();
  await (await handleMcp(request, owner, () => services)).text();
  return cpuMs() - start;
}

test('report first-method Node CPU samples', async () => {
  const requests = {
    initialize: {
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'c', version: '1' },
      },
    },
    'tools/list': { method: 'tools/list' },
    'create_problems 10×1 KB': {
      method: 'tools/call',
      params: {
        name: 'create_problems',
        arguments: {
          request_id: 'r',
          set_id: 's',
          problems: Array.from({ length: 10 }, () => ({ title: 'Q', body: 'x'.repeat(1000) })),
        },
      },
    },
  };
  for (const [label, message] of Object.entries(requests)) {
    const ms = await measure({ jsonrpc: '2.0', id: 1, ...message });
    console.log(`${label}: ${ms.toFixed(2)} ms CPU (first method call)`);
  }
});

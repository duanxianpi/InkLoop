import test from 'node:test';
import assert from 'node:assert/strict';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { loadSource } from './load-source.mjs';

// The hand-rolled MCP endpoint (src/server/mcp/handler.ts), exercised in process without OAuth.
// The official MCP client is the conformance reference; edge cases below cover what it never sends.

// workerd's FixedLengthStream, for the streamed get_submission image: a pass-through in Node.
globalThis.FixedLengthStream ??= class extends TransformStream {
  constructor() {
    super();
  }
};

const { handleMcp, HttpError } = await loadSource(
  'src/server/mcp/handler.ts',
  'src/server/http/errors.ts',
);

function owner(scopes = ['mcp:read', 'mcp:write']) {
  return {
    ownerId: 1,
    authEpoch: 1,
    scopes,
    requireScope(scope) {
      if (!scopes.includes(scope)) throw new HttpError(403, 'Missing ' + scope + ' scope');
    },
  };
}

// Services that succeed, recording what each tool passed through.
function fakeServices(calls = []) {
  const record = (name, value) => async (input) => {
    calls.push([name, input]);
    return value;
  };
  return {
    problems: {
      create: record('problems.create', { set_id: 's1', problem_ids: ['p1'] }),
      list: record('problems.list', { problems: [], next_cursor: null }),
    },
    submissions: {
      latest: async (input) => {
        calls.push(['submissions.latest', input]);
        return {
          status: 'ready',
          snapshot_id: 'snap1',
          image: {
            mimeType: 'image/png',
            body: new Blob(['iVBORw0KGgo=']).stream(),
            length: 12,
          },
        };
      },
    },
    feedback: { append: record('feedback.append', { feedback_id: 'f1' }) },
  };
}

const endpoint =
  (identity = owner(), services = fakeServices()) =>
  (request) =>
    handleMcp(request, identity, () => services);

function post(handler, body, headers = {}) {
  return handler(
    new Request('https://example.test/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': '2025-11-25',
        ...headers,
      },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
}

test('the official MCP client connects, lists and calls every tool', async () => {
  const calls = [];
  const handler = endpoint(owner(), fakeServices(calls));
  const client = new Client({ name: 'conformance', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL('https://example.test/mcp'), {
      fetch: (url, init) => handler(new Request(url, init)),
    }),
  );
  try {
    assert.equal(client.getServerVersion().name, 'inkloop');
    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map((tool) => tool.name),
      ['create_problems', 'list_problems', 'get_submission', 'append_feedback'],
    );

    const created = await client.callTool({
      name: 'create_problems',
      arguments: { request_id: 'r1', set_id: 's1', problems: [{ title: 'Q', body: 'Solve.' }] },
    });
    assert.equal(created.isError, undefined);
    assert.deepEqual(created.structuredContent, { set_id: 's1', problem_ids: ['p1'] });

    const listed = await client.callTool({ name: 'list_problems', arguments: {} });
    assert.deepEqual(listed.structuredContent, { problems: [], next_cursor: null });

    const submission = await client.callTool({
      name: 'get_submission',
      arguments: { problem_id: 'p1' },
    });
    assert.deepEqual(submission.structuredContent, { status: 'ready', snapshot_id: 'snap1' });
    assert.equal(submission.content[1].type, 'image');
    assert.equal(submission.content[1].data, 'iVBORw0KGgo=', 'stored base64 is streamed verbatim');

    const feedback = await client.callTool({
      name: 'append_feedback',
      arguments: { problem_id: 'p1', snapshot_id: 'snap1', feedback: 'Good.', verdict: 'correct' },
    });
    assert.deepEqual(feedback.structuredContent, { feedback_id: 'f1' });

    // Invalid arguments come back as a tool error the model can read, and never reach services.
    const invalid = await client.callTool({
      name: 'create_problems',
      arguments: { request_id: 'r2', problems: [{ title: 'Q', body: 'Solve.' }] },
    });
    assert.equal(invalid.isError, true);
    assert.equal(invalid.structuredContent.error, 'invalid_request');
    assert.match(invalid.structuredContent.message, /exactly one of set_id or new_set/);
    assert.deepEqual(
      calls.map(([name]) => name),
      ['problems.create', 'problems.list', 'submissions.latest', 'feedback.append'],
    );
  } finally {
    await client.close();
  }
});

test('mutation tools require mcp:write before validating input', async () => {
  const handler = endpoint(owner(['mcp:read']));
  const response = await post(handler, {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'append_feedback', arguments: {} },
  });
  const { result } = await response.json();
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.error, 'forbidden');
});

test('protocol edges follow JSON-RPC and Streamable HTTP', async () => {
  const handler = endpoint();
  const rpc = (method, params, id = 1) => post(handler, { jsonrpc: '2.0', id, method, params });

  // Version negotiation: a supported version is echoed, anything else gets ours.
  for (const [requested, expected] of [
    ['2025-06-18', '2025-06-18'],
    ['2024-11-05', '2025-11-25'],
  ]) {
    const response = await rpc('initialize', {
      protocolVersion: requested,
      capabilities: {},
      clientInfo: { name: 'c', version: '1' },
    });
    assert.equal((await response.json()).result.protocolVersion, expected);
  }

  assert.deepEqual((await (await rpc('ping', undefined, 'a')).json()).result, {});
  assert.equal((await (await rpc('resources/list', {})).json()).error.code, -32601);
  assert.equal((await (await rpc('tools/call', { name: 'nope' })).json()).error.code, -32602);
  assert.equal((await (await rpc('tools/call', { name: 'toString' })).json()).error.code, -32602);

  const notification = await post(handler, { jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(notification.status, 202);
  assert.equal(await notification.text(), '');

  const statusOf = async (response, code) => {
    if (code !== undefined) assert.equal((await response.clone().json()).error.code, code);
    return response.status;
  };
  assert.equal(await statusOf(await post(handler, '{'), -32700), 400);
  assert.equal(await statusOf(await post(handler, [{ jsonrpc: '2.0', id: 1 }]), -32600), 400);
  assert.equal(await statusOf(await post(handler, { jsonrpc: '1.0', id: 1, method: 'ping' })), 400);
  assert.equal(
    await statusOf(await post(handler, { jsonrpc: '2.0', id: null, method: 'ping' })),
    400,
  );
  assert.equal(
    await statusOf(await post(handler, '{}', { 'MCP-Protocol-Version': '1999-01-01' })),
    400,
  );
  assert.equal(await statusOf(await post(handler, '{}', { 'Content-Type': 'text/plain' })), 415);
  for (const method of ['GET', 'DELETE']) {
    const response = await handler(new Request('https://example.test/mcp', { method }));
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('Allow'), 'POST');
  }
});

test('rejects missing initialization fields and non-finite request ids', async () => {
  const handler = endpoint();
  const invalid = await post(handler, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert.equal((await invalid.json()).error.code, -32602);
  const overflow = await post(handler, '{"jsonrpc":"2.0","id":1e400,"method":"ping"}');
  assert.equal(overflow.status, 400);
  assert.equal((await overflow.json()).error.code, -32600);
});

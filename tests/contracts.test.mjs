import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSource } from './load-source.mjs';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';

const { createProblemsInput } = await loadSource('src/shared/schemas.ts');
const { LIMITS } = await loadSource('src/shared/limits.ts');
const { boundedBytes, boundedJson } = await loadSource('src/server/http/body.ts');
const base = { request_id: 'retry-1', problems: [{ title: 'Question', body: 'Explain this.' }] };

test('problem destination is unambiguous at both hierarchy levels', () => {
  for (const input of [
    base,
    { ...base, set_id: 's1', new_set: { title: 'Set', collection_id: 'c1' } },
    { ...base, new_set: { title: 'Set' } },
    { ...base, new_set: { title: 'Set', collection_id: 'c1', new_collection_title: 'Course' } },
  ]) {
    assert.equal(createProblemsInput.safeParse(input).success, false);
  }
  for (const input of [
    { ...base, set_id: 's1' },
    { ...base, new_set: { title: 'Set', collection_id: 'c1' } },
    { ...base, new_set: { title: 'Set', new_collection_title: 'Course' } },
  ])
    assert.equal(createProblemsInput.safeParse(input).success, true);
});

test('MCP accepts valid large batches and rejects ambiguous calls before the tool executes', async () => {
  let calls = 0;
  const handler = createMcpHandler(
    () => {
      const server = new McpServer({ name: 'contracts-test', version: '1.0.0' });
      server.registerTool('create_problems', { inputSchema: createProblemsInput }, async () => {
        calls++;
        return { content: [{ type: 'text', text: 'accepted' }] };
      });
      return server;
    },
    { legacy: 'stateless', maxRequestBodySize: LIMITS.mcpRequestBytes },
  );
  const send = (method, params) =>
    handler.fetch(
      new Request('https://example.test/mcp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'MCP-Protocol-Version': '2025-11-25',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      }),
    );
  const list = await send('tools/list', {});
  assert.equal(list.status, 200);
  assert.match(await list.text(), /create_problems/);
  const valid = {
    ...base,
    set_id: 's1',
    problems: Array.from({ length: 50 }, () => ({
      title: 'Question',
      body: '\u0001'.repeat(20000),
    })),
  };
  const response = await send('tools/call', { name: 'create_problems', arguments: valid });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /accepted/);
  assert.equal(calls, 1);
  const invalid = await send('tools/call', { name: 'create_problems', arguments: base });
  assert.match(await invalid.text(), /exactly one/);
  assert.equal(calls, 1);
  const oversized = await handler.fetch(
    new Request('https://example.test/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': '2025-11-25',
      },
      body: ' '.repeat(LIMITS.mcpRequestBytes + 1),
    }),
  );
  assert.equal(oversized.status, 413);
});

test('stream limits apply without Content-Length and cancel oversized input', async () => {
  let cancelled = false;
  let chunks = 0;
  const stream = new ReadableStream({
    pull(controller) {
      chunks++;
      controller.enqueue(new Uint8Array(6));
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request('https://example.test', {
    method: 'PUT',
    body: stream,
    duplex: 'half',
  });
  await assert.rejects(boundedBytes(request, 10), (error) => error.code === 'payload_too_large');
  assert.equal(cancelled, true);
  assert.ok(chunks <= 3);
  const exact = new Request('https://example.test', { method: 'PUT', body: '1234567890' });
  assert.equal((await boundedBytes(exact, 10)).byteLength, 10);
});

test('malformed JSON is a client error rather than a server error', async () => {
  const request = new Request('https://example.test', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: '{',
  });
  await assert.rejects(boundedJson(request, 100), (error) => error.code === 'invalid_request');
});

test('web client forwards filters and next-page cursors', async () => {
  const { api } = await loadSource('src/web/api.ts');
  const original = globalThis.fetch;
  let requested;
  globalThis.fetch = async (path) => {
    requested = path;
    return Response.json({ problems: [], next_cursor: null });
  };
  try {
    await api.problems({
      collection_id: 'collection / 1',
      set_id: 'set1',
      cursor: 'next+page',
      answer_state: 'working',
      limit: 25,
    });
    const url = new URL(requested, 'https://example.test');
    assert.equal(url.searchParams.get('collection_id'), 'collection / 1');
    assert.equal(url.searchParams.get('set_id'), 'set1');
    assert.equal(url.searchParams.get('cursor'), 'next+page');
    assert.equal(url.searchParams.get('answer_state'), 'working');
    assert.equal(url.searchParams.get('limit'), '25');
  } finally {
    globalThis.fetch = original;
  }
});

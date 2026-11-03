import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSource } from './load-source.mjs';

const schemas = await loadSource('src/shared/schemas.ts');
const { createProblemsInput } = schemas;
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
  const { handleMcp } = await loadSource('src/server/mcp/handler.ts');
  let calls = 0;
  const services = {
    problems: {
      create: async () => {
        calls++;
        return { accepted: true };
      },
    },
  };
  const owner = { ownerId: 1, authEpoch: 1, scopes: ['mcp:write'], requireScope() {} };
  const send = (body) =>
    handleMcp(
      new Request('https://example.test/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'MCP-Protocol-Version': '2025-11-25' },
        body,
      }),
      owner,
      () => services,
    );
  const call = (args) =>
    send(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'create_problems', arguments: args },
      }),
    );
  // The largest permitted batch, with JSON escaping inflating every character, fits the envelope.
  const valid = {
    ...base,
    set_id: 's1',
    problems: Array.from({ length: 50 }, () => ({
      title: 'Question',
      body: '\u0001'.repeat(20000),
    })),
  };
  const response = await call(valid);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /accepted/);
  assert.equal(calls, 1);
  const invalid = await call(base);
  assert.match(await invalid.text(), /exactly one/);
  assert.equal(calls, 1);
  const oversized = await send(' '.repeat(LIMITS.mcpRequestBytes + 1));
  assert.equal(oversized.status, 413);
});

// The plain MCP validators must agree with the zod schemas they mirror (src/server/mcp/input.ts).
test('MCP input validators accept and reject exactly what the zod contracts do', async () => {
  const input = await loadSource('src/server/mcp/input.ts');
  const problem = { title: 'Q', body: 'B' };
  const cases = {
    parseCreateProblems: [
      schemas.createProblemsInput,
      [
        { ...base, set_id: 's1' },
        { ...base, set_id: 's1', extra: 'ignored' },
        { ...base, set_id: 's1', problems: [{ ...problem, type: 'proof' }] },
        { ...base, new_set: { title: 'Set', collection_id: 'c1' } },
        { ...base, new_set: { title: 'Set', new_collection_title: 'Course' } },
        base,
        { ...base, set_id: 's1', new_set: { title: 'Set', collection_id: 'c1' } },
        { ...base, new_set: { title: 'Set' } },
        { ...base, new_set: { title: 'Set', collection_id: 'c1', new_collection_title: 'C' } },
        { ...base, set_id: '' },
        { ...base, set_id: null },
        { ...base, set_id: 's1', request_id: 'x'.repeat(201) },
        { ...base, set_id: 's1', problems: [] },
        { ...base, set_id: 's1', problems: Array(51).fill(problem) },
        { ...base, set_id: 's1', problems: [{ title: 'Q', body: 'x'.repeat(20001) }] },
        { ...base, set_id: 's1', problems: [{ ...problem, type: '' }] },
        { ...base, set_id: 's1', problems: [null] },
        { ...base, set_id: 's1', problems: {} },
        [],
        null,
      ],
    ],
    parseListProblems: [
      schemas.listProblemsInput,
      [
        {},
        { collection_id: 'c', set_id: 's', answer_state: 'working', cursor: '', limit: 100 },
        { answer_state: 'done' },
        { limit: 0 },
        { limit: 101 },
        { limit: 1.5 },
        { limit: '5' },
        { cursor: 'x'.repeat(21) },
      ],
    ],
    parseGetSubmission: [
      schemas.getSubmissionInput,
      [{ problem_id: 'p' }, {}, { problem_id: 'x'.repeat(101) }, { problem_id: 1 }],
    ],
    parseAppendFeedback: [
      schemas.appendFeedbackInput,
      [
        { problem_id: 'p', snapshot_id: 's', feedback: 'f' },
        {
          problem_id: 'p',
          snapshot_id: 's',
          feedback: 'f',
          verdict: 'partial',
          callouts: [{ label: 'l', text: 't' }],
          idempotency_key: 'k',
        },
        { problem_id: 'p', snapshot_id: 's', feedback: '' },
        { problem_id: 'p', snapshot_id: 's', feedback: 'f', verdict: 'wrong' },
        { problem_id: 'p', snapshot_id: 's', feedback: 'f', callouts: [{ label: '', text: 't' }] },
        {
          problem_id: 'p',
          snapshot_id: 's',
          feedback: 'f',
          callouts: Array(21).fill({ label: 'l', text: 't' }),
        },
        { problem_id: 'p', feedback: 'f' },
      ],
    ],
  };
  for (const [name, [schema, values]] of Object.entries(cases))
    for (const value of values) {
      const zod = schema.safeParse(value);
      let parsed;
      try {
        parsed = input[name](value);
      } catch (error) {
        assert.equal(error.status, 400);
      }
      assert.equal(parsed !== undefined, zod.success, `${name}: ${JSON.stringify(value)}`);
      // Accepted values carry the same data; zod omits absent keys where ours hold undefined.
      if (zod.success) assert.deepEqual(JSON.parse(JSON.stringify(parsed)), zod.data);
    }
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

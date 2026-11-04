import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { applyMigrations } from './migrations.mjs';
import { createHash, randomBytes } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
const { Miniflare, convertV4MiniflareOptions } = require(
  require.resolve('miniflare', { paths: [require.resolve('wrangler/package.json')] }),
);

// Product persistence against local workerd, D1, R2 and the ChangeHub: the real routes, MCP
// endpoint, services, migrations and triggers. Only OAuth is bypassed (see fixtures/product-worker.ts).

const origin = 'https://whiteboard.example';

function png(width, height) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const rows = Buffer.alloc((width * 3 + 1) * height, 255);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]).toString('base64');
}

const doc = (strokes) =>
  JSON.stringify({
    store: { 'shape:a': { id: 'shape:a', typeName: 'shape', strokes } },
    schema: {},
  });

async function start() {
  const bundle = await build({
    entryPoints: [new URL('fixtures/product-worker.ts', import.meta.url).pathname],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    external: ['cloudflare:*', 'node:*'],
    write: false,
    logLevel: 'warning',
  });
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: bundle.outputFiles[0].text,
      compatibilityDate: '2026-11-02',
      compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'],
      d1Databases: ['DB'],
      kvNamespaces: ['OAUTH_KV'],
      r2Buckets: ['STORAGE'],
      durableObjects: { CHANGE_HUB: { className: 'ChangeHub', useSQLite: true } },
      serviceBindings: { ASSETS: () => new Response('shell') },
    }),
  );
  const db = await mf.getD1Database('DB');
  await applyMigrations(db);
  await db.prepare('INSERT INTO owner VALUES(1,unixepoch())').run();
  await db
    .prepare(
      'UPDATE auth_state SET initialized_at=unixepoch(),canonical_origin=?,rp_id=?,auth_epoch=1',
    )
    .bind(origin, 'whiteboard.example')
    .run();
  const token = randomBytes(32).toString('base64url');
  await db
    .prepare('INSERT INTO web_sessions VALUES(?,1,1,unixepoch()+3600,unixepoch())')
    .bind(createHash('sha256').update(token).digest('base64url'))
    .run();
  const cookie = '__Host-owner=' + token;
  const web = (path, init = {}) =>
    mf.dispatchFetch(origin + path, {
      ...init,
      headers: { cookie, Origin: origin, ...init.headers },
    });
  let rpc = 0;
  const mcp = async (name, args, epoch) => {
    const response = await mf.dispatchFetch(
      origin + '/__test/mcp' + (epoch === undefined ? '' : '?epoch=' + epoch),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: ++rpc,
          method: 'tools/call',
          params: { name, arguments: args },
        }),
      },
    );
    assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer());
    // Streamed image responses declare their exact length up front.
    if (name === 'get_submission' && response.headers.has('content-length'))
      assert.equal(Number(response.headers.get('content-length')), bytes.byteLength);
    const text = bytes.toString('utf8');
    return JSON.parse(text).result;
  };
  return { mf, db, web, mcp, bucket: await mf.getR2Bucket('STORAGE') };
}

const save = (web, id, { base, epoch, fingerprint, content = true, body = doc(1) }) =>
  web(
    `/api/problems/${id}/canvas?base_revision=${base}&edit_epoch=${epoch}&fingerprint=${fingerprint}&has_content=${content ? 1 : 0}`,
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body },
  );
const markReady = (web, id, { revision, epoch, key, image }) =>
  web(`/api/problems/${id}/submissions?revision=${revision}&edit_epoch=${epoch}`, {
    method: 'POST',
    headers: { 'Idempotency-Key': key, ...(image ? { 'Content-Type': 'text/plain' } : {}) },
    body: image ?? '',
  });
const json = async (response, status = 200) => {
  const body = await response.json();
  assert.equal(response.status, status, JSON.stringify(body));
  return body;
};
const listKeys = async (bucket, prefix) =>
  (await bucket.list({ prefix })).objects.map((object) => object.key).sort();

test('problems, canvas saves, Snapshot commits and feedback keep their invariants', async () => {
  const { mf, db, web, mcp, bucket } = await start();
  try {
    // create_problems: explicit new destinations, order preserved, idempotent on request_id.
    const create = {
      request_id: 'req-1',
      new_set: { title: 'W7 · Variational inference', new_collection_title: 'CSC2506' },
      problems: [
        { title: 'KL between Gaussians', body: 'Show $KL$.', type: 'Derivations' },
        { title: 'Derive the ELBO', body: 'Use Jensen.' },
      ],
    };
    const created = (await mcp('create_problems', create)).structuredContent;
    assert.equal(created.problem_ids.length, 2);
    assert.deepEqual((await mcp('create_problems', create)).structuredContent, created);
    const conflict = await mcp('create_problems', { ...create, problems: [create.problems[0]] });
    assert.equal(conflict.isError, true);
    assert.equal(conflict.structuredContent.error, 'idempotency_conflict');
    const appended = (
      await mcp('create_problems', {
        request_id: 'req-2',
        set_id: created.set_id,
        problems: [{ title: 'Third', body: 'More.' }],
      })
    ).structuredContent;
    const [p1, p2] = created.problem_ids;
    const p3 = appended.problem_ids[0];
    const missing = await mcp('create_problems', {
      request_id: 'req-3',
      new_set: { title: 'Set', collection_id: 'col_missing' },
      problems: [{ title: 'x', body: 'y' }],
    });
    assert.equal(missing.structuredContent.error, 'not_found');

    const { collections } = await json(await web('/api/collections'));
    assert.deepEqual(
      collections.map((c) => [c.title, c.sets.map((s) => s.title)]),
      [['CSC2506', ['W7 · Variational inference']]],
    );
    const page1 = await json(await web('/api/problems?limit=2'));
    assert.deepEqual(
      page1.problems.map((p) => [p.id, p.sort_order, p.tile]),
      [
        [p1, 1, 'empty'],
        [p2, 2, 'empty'],
      ],
    );
    const page2 = await json(await web('/api/problems?limit=2&cursor=' + page1.next_cursor));
    assert.deepEqual(
      page2.problems.map((p) => p.id),
      [p3],
    );
    assert.equal(page2.next_cursor, null);

    // Canvas: nothing stored yet; optimistic saves; stale writes are rejected without leftovers.
    const empty = await web(`/api/problems/${p1}/canvas`);
    assert.equal(empty.status, 204);
    assert.equal(empty.headers.get('x-canvas-revision'), '0');
    assert.equal(
      (await json(await markReady(web, p1, { revision: 0, epoch: 0, key: 'k0' }), 422)).error,
      'empty_canvas',
    );
    assert.deepEqual(await json(await save(web, p1, { base: 0, epoch: 0, fingerprint: 'f1' })), {
      problem_id: p1,
      revision: 1,
      has_content: true,
    });
    const stale = await json(await save(web, p1, { base: 0, epoch: 0, fingerprint: 'fx' }), 409);
    assert.equal(stale.error, 'revision_conflict');
    assert.equal(stale.revision, 1);
    await json(await save(web, p1, { base: 1, epoch: 0, fingerprint: 'f2', body: doc(2) }));
    await json(await save(web, p1, { base: 2, epoch: 0, fingerprint: 'f3', body: doc(3) }));
    // Current and previous revisions are kept; the older one and the rejected upload are gone.
    assert.equal((await listKeys(bucket, `canvas/${p1}/`)).length, 2);
    const stored = await web(`/api/problems/${p1}/canvas`);
    assert.equal(stored.headers.get('x-canvas-revision'), '3');
    assert.equal(stored.headers.get('x-canvas-fingerprint'), 'f3');
    assert.equal(await stored.text(), doc(3));
    const noLength = await web(
      `/api/problems/${p1}/canvas?base_revision=3&edit_epoch=0&fingerprint=f&has_content=1`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: new Blob([doc(1)]).stream(),
        duplex: 'half',
      },
    );
    assert.ok([400, 411].includes(noLength.status));

    // Mark ready: the image is streamed into R2 and published by the D1 commit.
    const image1 = png(3, 2);
    const wrongState = await json(
      await markReady(web, p1, { revision: 2, epoch: 0, key: 'k1', image: image1 }),
      409,
    );
    assert.equal(wrongState.error, 'revision_conflict');
    const notPng = await json(
      await markReady(web, p1, {
        revision: 3,
        epoch: 0,
        key: 'k1',
        image: Buffer.from('not a png image at all, really!!').toString('base64'),
      }),
      400,
    );
    assert.match(notPng.message, /PNG/);
    // A valid header followed by non-base64 bytes would corrupt get_submission's JSON: rejected
    // while streaming, with nothing stored. The image text has to be base64 throughout.
    const header = image1.slice(0, 32);
    for (const [index, malformed] of [
      header + '"xxx',
      header + 'AA=A',
      header + 'A===',
      header + 'AAAA'.repeat(5000) + '}AAA',
    ].entries()) {
      const rejected = await json(
        await markReady(web, p1, { revision: 3, epoch: 0, key: 'bad-' + index, image: malformed }),
        400,
      );
      assert.match(rejected.message, /base64/);
    }
    // The same, arriving in several chunks: rejected mid-stream after the upload started.
    const tail = 'AAAA'.repeat(16384) + '"AAA';
    const chunked = await web(`/api/problems/${p1}/submissions?revision=3&edit_epoch=0`, {
      method: 'POST',
      headers: {
        'Idempotency-Key': 'bad-chunked',
        'Content-Type': 'text/plain',
        'Content-Length': String(header.length + tail.length),
      },
      body: new ReadableStream({
        async start(controller) {
          controller.enqueue(new TextEncoder().encode(header));
          await new Promise((resolve) => setTimeout(resolve, 20));
          for (let i = 0; i < tail.length; i += 8192)
            controller.enqueue(new TextEncoder().encode(tail.slice(i, i + 8192)));
          controller.close();
        },
      }),
      duplex: 'half',
    });
    assert.equal(chunked.status, 400, await chunked.clone().text());
    assert.deepEqual(await listKeys(bucket, `snapshots/${p1}/`), []);
    assert.equal(
      (await db.prepare('SELECT COUNT(*) n FROM snapshots WHERE problem_id = ?').bind(p1).first())
        .n,
      0,
    );
    const ready1 = await json(
      await markReady(web, p1, { revision: 3, epoch: 0, key: 'k1', image: image1 }),
    );
    assert.equal(ready1.reused, false);
    assert.equal(ready1.answer_state, 'ready_for_review');
    assert.equal(ready1.snapshot.sequence, 1);
    assert.deepEqual([ready1.snapshot.width, ready1.snapshot.height], [3, 2]);
    // Retrying the same key returns the same commit; reusing it for other input is rejected.
    assert.deepEqual(
      await json(await markReady(web, p1, { revision: 3, epoch: 0, key: 'k1', image: image1 })),
      ready1,
    );
    assert.equal(
      (
        await json(
          await markReady(web, p1, { revision: 1, epoch: 0, key: 'k1', image: image1 }),
          409,
        )
      ).error,
      'idempotency_conflict',
    );
    assert.equal(
      (await json(await save(web, p1, { base: 3, epoch: 0, fingerprint: 'f4' }), 409)).error,
      'canvas_locked',
    );
    assert.deepEqual(await listKeys(bucket, `snapshots/${p1}/`), [
      `snapshots/${p1}/${ready1.snapshot.id}.b64`,
    ]);

    const imageText = await web(`/api/snapshots/${ready1.snapshot.id}/image`);
    assert.equal(await imageText.text(), image1);
    assert.equal(imageText.headers.get('cache-control'), 'private, max-age=31536000, immutable');

    // get_submission streams the stored text verbatim inside the JSON-RPC response.
    const submission = await mcp('get_submission', { problem_id: p1 });
    assert.equal(submission.content[1].data, image1);
    assert.equal(submission.structuredContent.snapshot_id, ready1.snapshot.id);
    assert.equal(submission.structuredContent.has_unsubmitted_changes, false);
    assert.equal(
      (await mcp('get_submission', { problem_id: p2 })).structuredContent.status,
      'not_ready',
    );

    // Resume advances the epoch once; old-epoch saves are rejected.
    const resumed = await json(await web(`/api/problems/${p1}/resume`, { method: 'POST' }));
    assert.deepEqual(
      [resumed.resumed, resumed.edit_epoch, resumed.answer_state],
      [true, 1, 'working'],
    );
    const again = await json(await web(`/api/problems/${p1}/resume`, { method: 'POST' }));
    assert.deepEqual([again.resumed, again.edit_epoch], [false, 1]);
    assert.equal(
      (await json(await save(web, p1, { base: 3, epoch: 0, fingerprint: 'f4' }), 409)).error,
      'edit_epoch_changed',
    );
    assert.equal(
      (await mcp('get_submission', { problem_id: p1 })).structuredContent.answer_state,
      'working',
    );

    // Unchanged content reuses the Snapshot, without an image.
    const reused = await json(await markReady(web, p1, { revision: 3, epoch: 1, key: 'k2' }));
    assert.deepEqual([reused.reused, reused.snapshot.id], [true, ready1.snapshot.id]);

    // Changed content needs an image and allocates the next sequence.
    await json(await web(`/api/problems/${p1}/resume`, { method: 'POST' }));
    await json(await save(web, p1, { base: 3, epoch: 2, fingerprint: 'f5', body: doc(5) }));
    assert.equal(
      (await mcp('get_submission', { problem_id: p1 })).structuredContent.has_unsubmitted_changes,
      true,
    );
    assert.equal(
      (await json(await markReady(web, p1, { revision: 4, epoch: 2, key: 'k3' }), 400)).error,
      'invalid_request',
    );
    const ready2 = await json(
      await markReady(web, p1, { revision: 4, epoch: 2, key: 'k4', image: png(4, 4) }),
    );
    assert.equal(ready2.snapshot.sequence, 2);

    // Feedback: explicit Snapshot, historical entries allowed, cross-problem references rejected.
    const late = await mcp('append_feedback', {
      problem_id: p1,
      snapshot_id: ready1.snapshot.id,
      feedback: 'Stops one step short.',
      verdict: 'incorrect',
      callouts: [{ kind: 'incorrect', math: 'x = 1', text: 'Expand the bracket.' }],
    });
    assert.ok(late.structuredContent.feedback_id);
    const keyed = {
      problem_id: p1,
      snapshot_id: ready2.snapshot.id,
      feedback: 'Fixed.',
      verdict: 'correct',
      idempotency_key: 'fb-1',
    };
    const first = (await mcp('append_feedback', keyed)).structuredContent;
    assert.deepEqual((await mcp('append_feedback', keyed)).structuredContent, first);
    await mcp('append_feedback', {
      problem_id: p1,
      snapshot_id: ready2.snapshot.id,
      feedback: 'Also tidy.',
    });
    const foreign = await mcp('append_feedback', {
      problem_id: p2,
      snapshot_id: ready1.snapshot.id,
      feedback: 'x',
    });
    assert.equal(foreign.structuredContent.error, 'not_found');

    const detail = await json(await web(`/api/problems/${p1}`));
    assert.equal(detail.feedback.length, 3);
    assert.deepEqual(detail.feedback[0].callouts, [
      { kind: 'incorrect', math: 'x = 1', text: 'Expand the bracket.' },
    ]);
    assert.deepEqual(
      [detail.tile, detail.trend, detail.latest_verdict],
      ['correct', 'improved', 'correct'],
    );
    const listed = (await mcp('list_problems', { answer_state: 'ready_for_review' }))
      .structuredContent;
    assert.deepEqual(
      listed.problems.map((p) => p.id),
      [p1],
    );

    // A newer Snapshot awaiting review shows Ready, not the stale verdict (F14).
    await json(await web(`/api/problems/${p1}/resume`, { method: 'POST' }));
    assert.equal((await json(await web(`/api/problems/${p1}`))).tile, 'working');
    await json(await save(web, p1, { base: 4, epoch: 3, fingerprint: 'f6' }));
    await json(await markReady(web, p1, { revision: 5, epoch: 3, key: 'k5', image: png(2, 2) }));
    const awaiting = await json(await web(`/api/problems/${p1}`));
    assert.deepEqual(
      [awaiting.tile, awaiting.latest_verdict, awaiting.trend],
      ['ready', null, 'improved'],
    );

    // Concurrent Mark ready with different keys: exactly one Snapshot, no orphaned image.
    await json(await save(web, p2, { base: 0, epoch: 0, fingerprint: 'g1' }));
    const racing = await Promise.all(
      ['r1', 'r2', 'r3'].map((key) =>
        markReady(web, p2, { revision: 1, epoch: 0, key, image: png(5, 5) }),
      ),
    );
    assert.deepEqual(racing.map((r) => r.status).sort(), [200, 409, 409]);
    const rows = await db
      .prepare('SELECT sequence FROM snapshots WHERE problem_id = ?')
      .bind(p2)
      .all();
    assert.deepEqual(rows.results, [{ sequence: 1 }]);
    assert.equal((await listKeys(bucket, `snapshots/${p2}/`)).length, 1);

    // Storage invariants hold even for direct SQL.
    await assert.rejects(
      db.prepare('UPDATE snapshots SET sequence = 9').run(),
      /snapshot_immutable/,
    );
    await assert.rejects(db.prepare('DELETE FROM feedback').run(), /feedback_append_only/);
    await assert.rejects(
      db
        .prepare("INSERT INTO feedback VALUES ('f', 99, ?, ?, NULL, 't', '[]', 0)")
        .bind(p2, ready1.snapshot.id)
        .run(),
      /FOREIGN KEY/,
    );
    await assert.rejects(
      db
        .prepare("INSERT INTO snapshots VALUES ('s', ?, 5, 'k', 1, 1, 1, 0, 'f', 0)")
        .bind(p3)
        .run(),
      /snapshot_sequence/,
    );

    // A request authorized under an older auth epoch writes nothing.
    await db.prepare('UPDATE auth_state SET auth_epoch = 2').run();
    const counts = async () =>
      await db
        .prepare(
          'SELECT (SELECT COUNT(*) FROM problems) p, (SELECT COUNT(*) FROM feedback) f, (SELECT COUNT(*) FROM idempotency) i',
        )
        .first();
    const before = await counts();
    const revoked = await mcp(
      'create_problems',
      { request_id: 'req-old', set_id: created.set_id, problems: [{ title: 'x', body: 'y' }] },
      1,
    );
    assert.equal(revoked.structuredContent.error, 'unauthorized');
    const revokedFeedback = await mcp(
      'append_feedback',
      { problem_id: p1, snapshot_id: ready1.snapshot.id, feedback: 'x' },
      1,
    );
    assert.equal(revokedFeedback.structuredContent.error, 'unauthorized');
    assert.deepEqual(await counts(), before);
  } finally {
    await mf.dispose();
  }
});

test('change counter, long poll and the notification-only ChangeHub', async () => {
  const { mf, web, mcp } = await start();
  try {
    const initial = await json(await web('/api/changes'));
    assert.deepEqual(initial, { seq: 0, changed: false });
    const upgrade = await web('/api/changes/socket', { headers: { Upgrade: 'websocket' } });
    assert.equal(upgrade.status, 101);
    const socket = upgrade.webSocket;
    socket.accept();
    const messages = [];
    socket.addEventListener('message', (event) => messages.push(JSON.parse(event.data)));
    const crossSite = await web('/api/changes/socket', {
      headers: { Upgrade: 'websocket', Origin: 'https://evil.example' },
    });
    assert.equal(crossSite.status, 403);

    const waiting = web('/api/changes?since=0&timeout=6');
    await mcp('create_problems', {
      request_id: 'r',
      new_set: { title: 'Set', new_collection_title: 'Course' },
      problems: [{ title: 'Q', body: 'B' }],
    });
    assert.deepEqual(await json(await waiting), { seq: 1, changed: true });
    for (let i = 0; i < 50 && !messages.length; i++) await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(messages, [{ type: 'changed', seq: 1 }]);
    assert.deepEqual(await json(await web('/api/changes?since=1&timeout=0')), {
      seq: 1,
      changed: false,
    });
    socket.close();
  } finally {
    await mf.dispose();
  }
});

test('agents can read, edit and remove problems, sets and collections', async () => {
  const { mf, db, web, mcp, bucket } = await start();
  try {
    const call = async (name, args) => (await mcp(name, args)).structuredContent;
    const created = await call('create_problems', {
      request_id: 'org-1',
      new_set: { title: 'W1', new_collection_title: 'Course' },
      problems: [
        { title: 'First', body: 'Show $x$.', type: 'Proofs' },
        { title: 'Second', body: 'More.' },
      ],
    });
    const [p1, p2] = created.problem_ids;
    const empty = await call('create_problems', {
      request_id: 'org-2',
      new_set: { title: 'Empty soon', collection_id: created.collection_id },
      problems: [{ title: 'Temp', body: 'Temp' }],
    });
    await call('delete_problems', { problem_ids: empty.problem_ids });

    // list_collections shows every set, including an empty one, with counts.
    const { collections } = await call('list_collections', {});
    assert.deepEqual(
      collections.map((c) => [c.title, c.sets.map((s) => [s.title, s.problem_count])]),
      [
        [
          'Course',
          [
            ['W1', 2],
            ['Empty soon', 0],
          ],
        ],
      ],
    );

    // update_problem edits text and category; null removes the category.
    const updated = await call('update_problem', {
      problem_id: p1,
      title: 'First, revised',
      type: null,
    });
    assert.deepEqual(updated, {
      problem_id: p1,
      title: 'First, revised',
      body: 'Show $x$.',
      type: null,
    });
    assert.equal((await mcp('update_problem', { problem_id: p1 })).isError, true);
    assert.equal(
      (await call('update_problem', { problem_id: 'missing', title: 'x' })).error,
      'not_found',
    );

    // Two Snapshots and feedback, then an earlier Snapshot by ID.
    await json(await save(web, p1, { base: 0, epoch: 0, fingerprint: 'a1' }));
    const s1 = (
      await json(await markReady(web, p1, { revision: 1, epoch: 0, key: 'o1', image: png(2, 2) }))
    ).snapshot;
    await json(await web(`/api/problems/${p1}/resume`, { method: 'POST' }));
    await json(await save(web, p1, { base: 1, epoch: 1, fingerprint: 'a2' }));
    await json(await markReady(web, p1, { revision: 2, epoch: 1, key: 'o2', image: png(3, 3) }));
    await call('append_feedback', {
      problem_id: p1,
      snapshot_id: s1.id,
      feedback: 'Close.',
      verdict: 'partial',
    });
    const earlier = await mcp('get_submission', { problem_id: p1, snapshot_id: s1.id });
    assert.deepEqual(
      [earlier.structuredContent.sequence, earlier.structuredContent.latest_sequence],
      [1, 2],
    );
    assert.equal(earlier.content[1].data, png(2, 2));
    assert.equal(
      (await call('get_submission', { problem_id: p2, snapshot_id: s1.id })).error,
      'not_found',
      'a Snapshot of another problem is not served',
    );

    // get_problem: statement, Snapshots without images, full feedback history.
    const problem = await call('get_problem', { problem_id: p1 });
    assert.equal(problem.body, 'Show $x$.');
    assert.deepEqual(
      problem.snapshots.map((s) => s.sequence),
      [1, 2],
    );
    assert.equal(problem.feedback.length, 1);
    assert.equal(problem.canvas_fingerprint, undefined);

    // Renames.
    assert.equal(
      (await call('update_problem_set', { set_id: created.set_id, title: 'Week 1' })).title,
      'Week 1',
    );
    assert.equal(
      (await call('update_collection', { collection_id: created.collection_id, title: 'CS' }))
        .title,
      'CS',
    );
    assert.equal(
      (await call('update_problem_set', { set_id: 'missing', title: 'x' })).error,
      'not_found',
    );

    // A set or collection with problems is not deleted.
    assert.equal(
      (await call('delete_problem_set', { set_id: created.set_id })).error,
      'invalid_request',
    );
    assert.equal(
      (await call('delete_collection', { collection_id: created.collection_id })).error,
      'invalid_request',
    );

    // delete_problems removes the problem with its canvas, Snapshots, feedback and stored objects.
    assert.ok((await listKeys(bucket, `snapshots/${p1}/`)).length === 2);
    const deleted = await call('delete_problems', { problem_ids: [p1, 'missing', p1] });
    assert.deepEqual(deleted, { deleted: [p1], not_found: ['missing'] });
    for (const table of ['snapshots', 'feedback'])
      assert.equal(
        (await db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE problem_id = ?`).bind(p1).first())
          .n,
        0,
      );
    assert.deepEqual(await listKeys(bucket, `snapshots/${p1}/`), []);
    assert.deepEqual(await listKeys(bucket, `canvas/${p1}/`), []);
    assert.equal((await db.prepare('SELECT COUNT(*) n FROM problem_deletions').first()).n, 0);
    assert.equal((await web(`/api/problems/${p1}`)).status, 404);
    // Outside a deletion, Snapshots and feedback stay immutable.
    await json(await save(web, p2, { base: 0, epoch: 0, fingerprint: 'b1' }));
    await json(await markReady(web, p2, { revision: 1, epoch: 0, key: 'o3', image: png(2, 2) }));
    await assert.rejects(db.prepare('DELETE FROM snapshots').run(), /snapshot_immutable/);

    await call('delete_problems', { problem_ids: [p2] });
    assert.deepEqual(await call('delete_problem_set', { set_id: created.set_id }), {
      deleted: created.set_id,
    });
    assert.deepEqual(await call('delete_collection', { collection_id: created.collection_id }), {
      deleted: created.collection_id,
    });
    assert.deepEqual((await call('list_collections', {})).collections, []);
  } finally {
    await mf.dispose();
  }
});

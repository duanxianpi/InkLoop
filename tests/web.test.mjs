import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadSource } from './load-source.mjs';

// Browser-side logic that does not need a browser: the save queue, untrusted text rendering and
// the shared review-status derivation. IndexedDB is absent in Node, so drafts use memory only.

const { CanvasSync, drafts } = await loadSource(
  'src/web/sync/canvasSync.ts',
  'src/web/sync/drafts.ts',
);
const { tokenize, RichText } = await loadSource('src/web/board/RichText.tsx');
const { tileState, trend } = await loadSource('src/shared/derive.ts');

/** A fetch stub answering canvas saves; `respond` decides each reply. */
function stubFetch(respond) {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    const request = { url: new URL(url, 'https://example.test'), body: init.body };
    requests.push(request);
    return respond(request, requests.length);
  };
  return { requests, restore: () => (globalThis.fetch = original) };
}
const content = (n) => ({ document: `{"n":${n}}`, fingerprint: `1:f${n}`, has_content: true });
const saved = (revision) => Response.json({ problem_id: 'p', revision, has_content: true });

test('the save queue reports Saved only for the newest acknowledged content', async () => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const stub = stubFetch(async (request, count) => {
    if (count === 1) await gate;
    return saved(Number(request.url.searchParams.get('base_revision')) + 1);
  });
  try {
    const statuses = [];
    const sync = new CanvasSync('p1', { revision: 4, edit_epoch: 2, fingerprint: 'f0' }, (s) =>
      statuses.push(s.status.kind),
    );
    sync.change(content(1));
    assert.equal((await drafts.get('p1')).document, '{"n":1}', 'stored locally before upload');
    const flushed = sync.flush();
    await new Promise((resolve) => setTimeout(resolve, 0));
    sync.change(content(2)); // Arrives while the first request is in flight.
    release();
    const base = await flushed;
    assert.equal(base.revision, 6);
    assert.deepEqual(
      stub.requests.map((r) => [r.url.searchParams.get('base_revision'), r.body]),
      [
        ['4', '{"n":1}'],
        ['5', '{"n":2}'],
      ],
    );
    assert.equal(stub.requests[0].url.searchParams.get('edit_epoch'), '2');
    assert.equal(sync.status.kind, 'saved');
    assert.ok(
      !statuses.slice(0, -1).includes('saved'),
      'never Saved while newer content is pending',
    );
    assert.equal(await drafts.get('p1'), null, 'acknowledged draft removed');
    sync.change(content(2));
    assert.equal(sync.status.kind, 'saved', 'unchanged content is not uploaded again');
    sync.dispose();
  } finally {
    stub.restore();
  }
});

test('offline saves keep the draft and retry; conflicts stop and keep it', async () => {
  let online = false;
  const stub = stubFetch(async (request) => {
    if (!online) throw new TypeError('Failed to fetch');
    return request.url.searchParams.get('base_revision') === '0'
      ? Response.json({ error: 'revision_conflict', revision: 3 }, { status: 409 })
      : saved(4);
  });
  try {
    const sync = new CanvasSync('p2', { revision: 0, edit_epoch: 0, fingerprint: null }, () => {});
    sync.change(content(1));
    await assert.rejects(sync.flush(), (error) => error.offline);
    assert.equal(sync.status.kind, 'offline');
    assert.ok(await drafts.get('p2'));

    online = true;
    await assert.rejects(sync.flush(), (error) => error.code === 'revision_conflict');
    assert.deepEqual(sync.status, { kind: 'conflict', code: 'revision_conflict' });
    assert.ok(await drafts.get('p2'), 'local work survives a conflict');
    sync.change(content(2));
    assert.equal((await drafts.get('p2')).document, '{"n":2}');
    assert.equal(sync.status.kind, 'conflict', 'no silent overwrite after a conflict');

    sync.keepLocal({ revision: 3, edit_epoch: 0, fingerprint: 'remote' });
    assert.equal((await sync.flush()).revision, 4);
    assert.equal(stub.requests.at(-1).url.searchParams.get('base_revision'), '3');
    assert.equal(await drafts.get('p2'), null);
    sync.dispose();
  } finally {
    stub.restore();
  }
});

test('a stale draft keeps its own base and surfaces as a conflict, never an overwrite', async () => {
  globalThis.innerWidth ??= 1024;
  const { BoardController } = await loadSource('src/web/board/controller.ts');
  const board = new BoardController();
  const stub = stubFetch(async () =>
    Response.json({ error: 'revision_conflict', revision: 7 }, { status: 409 }),
  );
  try {
    const draft = {
      problem_id: 'p3',
      document: '{"old":true}',
      fingerprint: '1:old',
      has_content: true,
      base_revision: 2,
      edit_epoch: 0,
      version: 1,
      updated_at: 1,
    };
    const shown = board.chooseDocument(
      'p3',
      {
        meta: { revision: 7, edit_epoch: 2, fingerprint: '1:new', answer_state: 'working' },
        document: '{"new":true}',
      },
      undefined,
      draft,
    );
    assert.equal(shown, '{"new":true}', "the other device's newer content is what is shown");
    const sync = board.syncs.get('p3');
    await assert.rejects(sync.flush(), (error) => error.code === 'revision_conflict');
    const sent = stub.requests[0].url.searchParams;
    assert.deepEqual([sent.get('base_revision'), sent.get('edit_epoch')], ['2', '0']);
    assert.deepEqual(sync.status, { kind: 'conflict', code: 'revision_conflict' });
    assert.equal(sync.unsaved.document, '{"old":true}', 'the draft waits for Keep / Load');
    sync.dispose();
  } finally {
    stub.restore();
  }
});

test('untrusted Markdown renders math and text, never markup', () => {
  assert.deepEqual(tokenize('Cost \\$5, $x^2$ and $$\\int f$$ \\(a\\) \\[b\\]'), [
    { math: false, text: 'Cost $5, ' },
    { math: true, tex: 'x^2', display: false },
    { math: false, text: ' and ' },
    { math: true, tex: '\\int f', display: true },
    { math: false, text: ' ' },
    { math: true, tex: 'a', display: false },
    { math: false, text: ' ' },
    { math: true, tex: 'b', display: true },
  ]);
  const html = renderToStaticMarkup(
    createElement(RichText, {
      text: '<img src=x onerror=alert(1)> **bold** `code`\n\nNext $y$',
    }),
  );
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('<b>bold</b>') && html.includes('<code>code</code>'));
  assert.equal((html.match(/<p>/g) ?? []).length, 2);
  assert.ok(html.includes('<span class="tex-src">$y$</span>'), 'TeX source until MathJax loads');
});

test('status tiles and trends follow the latest Snapshot (F14–F16)', () => {
  const snapshots = [{ id: 's1' }, { id: 's2' }];
  const base = { answer_state: 'ready_for_review', has_content: true, snapshots };
  const incorrectThenCorrect = [
    { snapshot_id: 's1', verdict: 'incorrect' },
    { snapshot_id: 's2', verdict: 'correct' },
  ];
  assert.equal(tileState({ ...base, feedback: incorrectThenCorrect }), 'correct');
  assert.equal(trend({ ...base, feedback: incorrectThenCorrect }), 'improved');
  assert.equal(
    trend({
      ...base,
      feedback: [
        { snapshot_id: 's1', verdict: 'correct' },
        { snapshot_id: 's2', verdict: 'incorrect' },
      ],
    }),
    'regressed',
  );
  const awaiting = { ...base, feedback: [{ snapshot_id: 's1', verdict: 'correct' }] };
  assert.equal(tileState(awaiting), 'ready', 'a new Snapshot is Ready, not the stale verdict');
  const sameSnapshot = [
    { snapshot_id: 's2', verdict: 'incorrect' },
    { snapshot_id: 's2', verdict: 'correct' },
    { snapshot_id: 's2', verdict: null },
  ];
  assert.equal(
    trend({ ...base, feedback: sameSnapshot }),
    'correct',
    'no trend within one Snapshot',
  );
  assert.equal(tileState({ ...base, feedback: sameSnapshot, answer_state: 'working' }), 'working');
  assert.equal(
    tileState({ answer_state: 'working', has_content: false, snapshots: [], feedback: [] }),
    'empty',
  );
});

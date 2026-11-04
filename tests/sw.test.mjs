import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSource } from './load-source.mjs';

// The service worker (src/sw/sw.ts) against an in-memory Cache Storage and a scripted network.

const origin = 'https://whiteboard.example';
const handlers = {};
const stores = new Map();
let failPuts = false;
let network = async () => new Response('unset', { status: 500 });

class FakeCache {
  entries = new Map();
  key = (request) => new URL(typeof request === 'string' ? request : request.url, origin).href;
  async match(request) {
    return this.entries.get(this.key(request))?.clone();
  }
  async put(request, response) {
    if (failPuts) throw new DOMException('Quota exceeded', 'QuotaExceededError');
    this.entries.set(this.key(request), response);
  }
  async addAll(paths) {
    for (const path of paths) {
      const response = await fetch(path);
      if (!response.ok) throw new TypeError('precache failed: ' + path);
      await this.put(path, response);
    }
  }
  async keys() {
    return [...this.entries.keys()].map((url) => ({ url }));
  }
  async delete(request) {
    return this.entries.delete(this.key(request));
  }
}

globalThis.caches = {
  async open(name) {
    if (!stores.has(name)) stores.set(name, new FakeCache());
    return stores.get(name);
  },
  keys: async () => [...stores.keys()],
  delete: async (name) => stores.delete(name),
  match: async (request, { cacheName }) => stores.get(cacheName)?.match(request),
};
globalThis.self = {
  location: new URL(origin),
  addEventListener: (type, handler) => (handlers[type] = handler),
  clients: { claim: async () => {} },
};
globalThis.BUILD_FILES = ['/assets/index-new.js', '/assets/tldraw/1/icons/icon/0_merged.svg'];
globalThis.PRECACHE = ['/assets/index-new.js'];
const realFetch = globalThis.fetch;
globalThis.fetch = (request, init) =>
  network(new URL(typeof request === 'string' ? request : request.url, origin), init);
const { CACHES } = await loadSource('src/sw/sw.ts', 'src/shared/offline.ts');
test.after(() => (globalThis.fetch = realFetch));

const reset = () => {
  stores.clear();
  failPuts = false;
};
const lifecycle = async (type) => {
  const waits = [];
  handlers[type]({ waitUntil: (promise) => waits.push(promise) });
  await Promise.all(waits);
};
/** Dispatch a fetch; resolves to the response, or null when the worker leaves it to the network. */
async function dispatch(path, { mode = 'cors', method = 'GET' } = {}) {
  const waits = [];
  let answer = null;
  handlers.fetch({
    request: { url: origin + path, method, mode },
    respondWith: (promise) => (answer = promise),
    waitUntil: (promise) => waits.push(promise),
  });
  const response = answer && (await answer);
  await Promise.all(waits);
  return response;
}
const cachedKeys = async (name) =>
  [...(await caches.open(name)).entries.keys()].map((url) => new URL(url).pathname);

test('a new version installs only after the board can open offline from its own files', async () => {
  reset();
  const order = [];
  network = async (url) => {
    order.push(url.pathname);
    return url.pathname === '/assets/index-new.js' && order.length === 1
      ? new Response('missing', { status: 404 })
      : new Response(url.pathname === '/' ? '<html>' : 'file', { status: 200 });
  };
  await assert.rejects(lifecycle('install'), /precache failed/);
  assert.deepEqual(await cachedKeys(CACHES.shell), [], 'no shell without its files');
  await lifecycle('install');
  assert.deepEqual(order.slice(1), ['/assets/index-new.js', '/']);
  assert.deepEqual(await cachedKeys(CACHES.shell), ['/']);
});

test('activation keeps data and current files and drops what no open page can need', async () => {
  reset();
  const assets = await caches.open(CACHES.assets);
  for (const path of ['/assets/index-old.js', ...BUILD_FILES])
    await assets.put(path, new Response('x'));
  await (await caches.open(CACHES.data)).put('/api/collections', new Response('{}'));
  await caches.open('inkloop-shell-0123456789ab');
  await lifecycle('activate');
  assert.deepEqual((await cachedKeys(CACHES.assets)).sort(), [...BUILD_FILES].sort());
  assert.deepEqual(await cachedKeys(CACHES.data), ['/api/collections']);
  assert.deepEqual((await caches.keys()).sort(), [CACHES.assets, CACHES.data].sort());
});

test('a failing cache write never replaces what the network answered', async () => {
  reset();
  await (await caches.open(CACHES.data)).put('/api/problems/p1', Response.json({ revision: 1 }));
  network = async () => Response.json({ revision: 2 });
  failPuts = true;
  assert.deepEqual(await (await dispatch('/api/problems/p1')).json(), { revision: 2 });
  assert.equal(
    await (await dispatch('/assets/index-new.js')).text(),
    JSON.stringify({ revision: 2 }),
  );
  assert.equal((await dispatch('/', { mode: 'navigate' })).status, 200);
});

test('offline: last reads and the shell come from this device; canvases and writes never do', async () => {
  reset();
  network = async (url) =>
    url.pathname === '/'
      ? new Response('<html>', { headers: { 'Content-Type': 'text/html' } })
      : Response.json({ online: url.pathname });
  await dispatch('/', { mode: 'navigate' });
  await dispatch('/api/collections');
  network = async () => {
    throw new TypeError('Failed to fetch');
  };
  assert.equal(await (await dispatch('/app', { mode: 'navigate' })).text(), '<html>');
  assert.deepEqual(await (await dispatch('/api/collections')).json(), {
    online: '/api/collections',
  });
  await assert.rejects(dispatch('/api/problems'), /Failed to fetch/);
  // Left to the network: the canvas, writes, account pages, MCP and the change feed.
  assert.equal(await dispatch('/api/problems/p1/canvas'), null);
  assert.equal(await dispatch('/api/problems/p1/canvas', { method: 'PUT' }), null);
  assert.equal(await dispatch('/settings/password', { mode: 'navigate' }), null);
  assert.equal(await dispatch('/mcp'), null);
  assert.equal(await dispatch('/api/changes'), null);
});

test('a 401 on a board read forgets the offline copy', async () => {
  reset();
  await (await caches.open(CACHES.data)).put('/api/collections', new Response('{}'));
  network = async () => new Response('', { status: 401 });
  assert.equal((await dispatch('/api/collections')).status, 401);
  assert.equal(stores.has(CACHES.data), false);
});

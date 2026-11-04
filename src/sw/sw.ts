import { CACHES } from '../shared/offline';
import { pageForPath } from '../shared/pages';

// Lets the installed board open without a network. The page shell and its files come from this
// device when the network is unreachable, and so do the board's last reads of its problem list and
// details. Canvases are not cached here: the board keeps the last acknowledged canvas with its
// revision in IndexedDB (src/web/sync/drafts.ts), so a stale copy never poses as server state.
// Writes, the change feed, MCP, OAuth and the account pages always go to the network.
//
// A new version installs only once everything the board needs is cached, and takes over only
// after every page of the previous version has closed (no skipWaiting). Until then, reloaded pages
// still get the newest shell from the network and their files are cached as they load.

declare const self: ServiceWorkerGlobalScope;
/** Set by the build (src/tooling/build.mjs): every file under /assets in this build. */
declare const BUILD_FILES: string[];
/** Set by the build: the files the board loads to open, cached before this version installs. */
declare const PRECACHE: string[];

const SHELL_URL = '/';

/** The board's reads, refreshed on every successful request. */
const BOARD_READS = [
  /^\/api\/collections$/,
  /^\/api\/preferences$/,
  /^\/api\/problems$/,
  /^\/api\/problems\/[^/]+$/,
  /^\/api\/snapshots\/[^/]+\/image$/,
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const assets = await caches.open(CACHES.assets);
      const missing: string[] = [];
      for (const path of PRECACHE) if (!(await assets.match(path))) missing.push(path);
      await assets.addAll(missing);
      // Last, so a cached shell never refers to files that are not cached yet.
      const shell = await fetch(SHELL_URL, { cache: 'no-store' });
      if (!shell.ok) throw new Error('shell_unavailable');
      await (await caches.open(CACHES.shell)).put(SHELL_URL, unredirected(shell));
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names: string[] = Object.values(CACHES);
      for (const key of await caches.keys()) if (!names.includes(key)) await caches.delete(key);
      // No page of an earlier build is open any more; its files are no longer needed.
      const current = new Set(BUILD_FILES);
      const assets = await caches.open(CACHES.assets);
      for (const request of await assets.keys())
        if (!current.has(new URL(request.url).pathname)) await assets.delete(request);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') {
    if (pageForPath(url.pathname)?.kind === 'canvas') event.respondWith(board(event));
  } else if (url.pathname.startsWith('/assets/')) event.respondWith(asset(event));
  else if (BOARD_READS.some((pattern) => pattern.test(url.pathname)))
    event.respondWith(read(event));
});

/** The board page: the network's shell (or its sign-in redirect), else the cached shell. */
async function board(event: FetchEvent) {
  let response: Response;
  try {
    response = await fetch(event.request);
  } catch (error) {
    return (await cached(CACHES.shell, SHELL_URL)) ?? Promise.reject(error);
  }
  // A sign-in redirect is an opaque, non-ok response; only the page itself is kept.
  if (response.ok) keep(event, CACHES.shell, SHELL_URL, unredirected(response.clone()));
  return response;
}

/** Hashed and versioned files never change: this device's copy first. */
async function asset(event: FetchEvent) {
  const copy = await cached(CACHES.assets, event.request);
  if (copy) return copy;
  const response = await fetch(event.request);
  if (response.ok) keep(event, CACHES.assets, event.request, response.clone());
  return response;
}

/** The newest data when online; the last copy when not. A 401 means signed out: forget it all. */
async function read(event: FetchEvent) {
  let response: Response;
  try {
    response = await fetch(event.request);
  } catch (error) {
    return (await cached(CACHES.data, event.request)) ?? Promise.reject(error);
  }
  if (response.ok) keep(event, CACHES.data, event.request, response.clone());
  else if (response.status === 401)
    event.waitUntil(caches.delete(CACHES.data).catch(() => undefined));
  return response;
}

const cached = (name: string, key: RequestInfo) =>
  caches.match(key, { cacheName: name }).catch(() => undefined);

/** Best effort: a full or failing cache never changes what the network answered. */
function keep(event: FetchEvent, name: string, key: RequestInfo, response: Response) {
  event.waitUntil(
    caches
      .open(name)
      .then((cache) => cache.put(key, response))
      .catch(() => undefined),
  );
}

/** A followed redirect cannot answer a navigation; the shell is the same page either way. */
function unredirected(response: Response) {
  return response.redirected
    ? new Response(response.body, { status: response.status, headers: response.headers })
    : response;
}

import type { PasskeyPurpose } from './auth';

type Page = {
  path: string;
  kind: 'passkey' | 'consent' | 'connections' | 'canvas';
  access: 'public' | 'session';
  purpose?: PasskeyPurpose;
};

/** Hono registration and React page selection share this small route registry. */
export const PAGES: readonly Page[] = [
  { path: '/setup', kind: 'passkey', purpose: 'bootstrap', access: 'public' },
  { path: '/login', kind: 'passkey', purpose: 'login', access: 'public' },
  { path: '/recover', kind: 'passkey', purpose: 'recovery', access: 'public' },
  { path: '/settings/passkeys/add', kind: 'passkey', purpose: 'add', access: 'session' },
  { path: '/settings/connected-apps', kind: 'connections', access: 'session' },
  { path: '/authorize', kind: 'consent', access: 'session' },
  { path: '/', kind: 'canvas', access: 'session' },
  { path: '/app', kind: 'canvas', access: 'session' },
];
export const pageForPath = (path: string) => PAGES.find((page) => page.path === path);

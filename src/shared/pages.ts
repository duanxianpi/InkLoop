import type { PasswordPurpose } from './auth';

type Page = {
  path: string;
  kind: 'password' | 'consent' | 'connections' | 'canvas';
  access: 'public' | 'session';
  purpose?: PasswordPurpose;
};

/** Hono registration and React page selection share this small route registry. */
export const PAGES: readonly Page[] = [
  { path: '/setup', kind: 'password', purpose: 'setup', access: 'public' },
  { path: '/login', kind: 'password', purpose: 'login', access: 'public' },
  { path: '/recover', kind: 'password', purpose: 'recovery', access: 'public' },
  { path: '/settings/password', kind: 'password', purpose: 'change', access: 'session' },
  { path: '/settings/connected-apps', kind: 'connections', access: 'session' },
  { path: '/authorize', kind: 'consent', access: 'session' },
  { path: '/', kind: 'canvas', access: 'session' },
  { path: '/app', kind: 'canvas', access: 'session' },
];
export const pageForPath = (path: string) => PAGES.find((page) => page.path === path);

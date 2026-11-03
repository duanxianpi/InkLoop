import { useEffect, useState } from 'react';
import { AuthPage } from './auth/AuthPage';
import type { AuthPageData, ConsentData, PasskeyPurpose } from '../shared/auth';
import './auth/styles.css';

const purposes: Record<string, PasskeyPurpose> = {
  '/setup': 'bootstrap',
  '/login': 'login',
  '/recover': 'recovery',
  '/settings/passkeys/add': 'add',
};

/** One browser entry. Hono serves this shell and enforces access on every private API. */
export function App() {
  const path = location.pathname;
  const [data, setData] = useState<AuthPageData | null>(null);
  const [error, setError] = useState('');
  const isAccount =
    path in purposes || path === '/authorize' || path === '/settings/connected-apps';

  useEffect(() => {
    if (!isAccount) return;
    const controller = new AbortController();
    void (async () => {
      try {
        if (path === '/settings/connected-apps') {
          setData({ kind: 'connections' });
          return;
        }
        if (path === '/authorize') {
          const response = await fetch('/auth/consent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: location.search }),
            signal: controller.signal,
          });
          if (response.status === 401) {
            location.assign(
              '/login?returnTo=' + encodeURIComponent(location.pathname + location.search),
            );
            return;
          }
          const result = (await response.json()) as ConsentData & { error?: string };
          if (!response.ok) throw new Error(result.error || 'Could not load authorization request');
          if (!controller.signal.aborted) setData({ ...result, kind: 'consent' });
          return;
        }
        const response = await fetch('/api/status', { signal: controller.signal });
        if (!response.ok) throw new Error('Could not load account status');
        const result = (await response.json()) as { initialized: boolean };
        if (!controller.signal.aborted)
          setData({
            kind: 'passkey',
            purpose: purposes[path],
            initialized: result.initialized,
            origin: location.origin,
          });
      } catch (failure) {
        if (!controller.signal.aborted)
          setError(failure instanceof Error ? failure.message : 'Could not load page');
      }
    })();
    return () => controller.abort();
  }, [path, isAccount]);

  if (!isAccount) return <main id="app" />; // Product canvas is still an architecture shell.
  if (data) return <AuthPage data={data} />;
  return (
    <main className="auth-page">
      <a className="brand" href="/app">
        Agent Whiteboard
      </a>
      <p role="status">{error || 'Loading…'}</p>
      {error && <button onClick={() => location.reload()}>Retry</button>}
    </main>
  );
}

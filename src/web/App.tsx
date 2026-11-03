import { useEffect, useState } from 'react';
import { AuthPage } from './auth/AuthPage';
import type { AuthPageData, ConsentData } from '../shared/auth';
import './auth/styles.css';
import { pageForPath } from '../shared/pages';

/** One browser entry. Hono serves this shell and enforces access on every private API. */
export function App() {
  const page = pageForPath(location.pathname);
  const [data, setData] = useState<AuthPageData | null>(null);
  const [error, setError] = useState('');
  const isAccount = !!page && page.kind !== 'canvas';

  useEffect(() => {
    if (!isAccount) return;
    const controller = new AbortController();
    void (async () => {
      try {
        if (page?.kind === 'connections') {
          setData({ kind: 'connections' });
          return;
        }
        if (page?.kind === 'consent') {
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
          const result = (await response.json()) as ConsentData & {
            error?: string;
            message?: string;
          };
          if (!response.ok)
            throw new Error(
              result.message || result.error || 'Could not load authorization request',
            );
          if (!controller.signal.aborted) setData({ ...result, kind: 'consent' });
          return;
        }
        const response = await fetch('/api/status', { signal: controller.signal });
        if (!response.ok) throw new Error('Could not load account status');
        const result = (await response.json()) as { initialized: boolean };
        if (!controller.signal.aborted)
          setData({
            kind: 'passkey',
            purpose: page!.purpose!,
            initialized: result.initialized,
            origin: location.origin,
          });
      } catch (failure) {
        if (!controller.signal.aborted)
          setError(failure instanceof Error ? failure.message : 'Could not load page');
      }
    })();
    return () => controller.abort();
  }, [page, isAccount]);

  if (!isAccount) return <main id="app" />; // Product canvas is still an architecture shell.
  if (data) return <AuthPage data={data} />;
  return (
    <main className="auth-page">
      <a className="brand" href="/app">
        InkLoop
      </a>
      <p role="status">{error || 'Loading…'}</p>
      {error && <button onClick={() => location.reload()}>Retry</button>}
    </main>
  );
}

import { lazy, Suspense, useEffect, useState } from 'react';
import { AuthPage, Layout } from './auth/AuthPage';
import type { AuthPageData, ConsentData } from '../shared/auth';
import { pageForPath } from '../shared/pages';

// The board (tldraw, MathJax, fonts) is its own chunk; account pages never load it.
const Board = lazy(() => import('./board/Board').then((module) => ({ default: module.Board })));

/** One browser entry. Hono serves this shell and enforces access on every private API. */
export function App() {
  const page = pageForPath(location.pathname);
  const [data, setData] = useState<AuthPageData | null>(null);
  const [error, setError] = useState('');
  // An OAuth error the app should hear about: the server-built redirect back to its callback.
  const [returnTo, setReturnTo] = useState<string | null>(null);
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
            redirectTo?: string;
          };
          if (!response.ok) {
            if (!controller.signal.aborted) setReturnTo(result.redirectTo ?? null);
            throw new Error(
              result.message || result.error || 'Could not load authorization request',
            );
          }
          if (!controller.signal.aborted) setData({ ...result, kind: 'consent' });
          return;
        }
        const response = await fetch('/api/status', { signal: controller.signal });
        if (!response.ok) throw new Error('Could not load account status');
        const result = (await response.json()) as { initialized: boolean; d1ConsoleUrl?: string };
        if (!controller.signal.aborted)
          setData({
            kind: 'password',
            purpose: page!.purpose!,
            initialized: result.initialized,
            origin: location.origin,
            d1ConsoleUrl: result.d1ConsoleUrl,
          });
      } catch (failure) {
        if (!controller.signal.aborted)
          setError(failure instanceof Error ? failure.message : 'Could not load page');
      }
    })();
    return () => controller.abort();
  }, [page, isAccount]);

  if (!isAccount)
    return (
      <Suspense fallback={null}>
        <Board />
      </Suspense>
    );
  if (data) return <AuthPage data={data} />;
  return (
    <Layout title={error ? "This page can't be shown" : 'Loading…'}>
      {error && <p role="status">{error}</p>}
      {error && returnTo ? (
        // Built by the server after validating the app's redirect URI; tells the app the request failed.
        <button onClick={() => location.assign(returnTo)}>Return to the app</button>
      ) : (
        error && <button onClick={() => location.reload()}>Retry</button>
      )}
    </Layout>
  );
}

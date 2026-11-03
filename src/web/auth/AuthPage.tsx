import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import type { AuthPageData, ConsentData } from '../../shared/auth';

async function post<T = unknown>(path: string, value: unknown) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
  const data = (await response.json()) as T & { error?: string; message?: string };
  if (!response.ok) throw new Error(data.message || data.error || 'Request failed');
  return data;
}

function Layout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="auth-page">
      <a className="brand" href="/app">
        InkLoop
      </a>
      <h1>{title}</h1>
      {children}
    </main>
  );
}

function PasskeyPage({ data }: { data: Extract<AuthPageData, { kind: 'passkey' }> }) {
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const { purpose, initialized, origin } = data;
  if (purpose === 'bootstrap' && initialized)
    return (
      <Layout title="Already set up">
        <p>This deployment already has an owner.</p>
        <a href="/login">Sign in</a>
      </Layout>
    );
  const registration = purpose !== 'login';
  const needsKey = purpose === 'bootstrap' || purpose === 'recovery';
  const title = {
    bootstrap: 'Set up your whiteboard',
    recovery: 'Recover ownership',
    add: 'Add a Passkey',
    login: 'Sign in',
  }[purpose];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setStatus('');
    try {
      if (purpose === 'bootstrap' && !confirmed)
        throw new Error('Confirm your deployment address first.');
      if (
        typeof PublicKeyCredential === 'undefined' ||
        !navigator.credentials ||
        (registration
          ? !PublicKeyCredential.parseCreationOptionsFromJSON
          : !PublicKeyCredential.parseRequestOptionsFromJSON)
      ) {
        throw new Error(
          'This browser does not support the required Passkey APIs. Use an up-to-date browser.',
        );
      }
      const prepared = await post<{
        id: string;
        publicKey: PublicKeyCredentialCreationOptionsJSON | PublicKeyCredentialRequestOptionsJSON;
      }>(`/auth/${purpose}/options`, { key: needsKey ? key : undefined, canonicalOrigin: origin });
      const credential = (
        registration
          ? await navigator.credentials.create({
              publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(
                prepared.publicKey as PublicKeyCredentialCreationOptionsJSON,
              ),
            })
          : await navigator.credentials.get({
              publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(
                prepared.publicKey as PublicKeyCredentialRequestOptionsJSON,
              ),
            })
      ) as PublicKeyCredential | null;
      if (!credential) throw new Error('No Passkey was selected. Please try again.');
      await post(`/auth/${purpose}/finish`, {
        id: prepared.id,
        key: needsKey ? key : undefined,
        response: credential.toJSON(),
      });
      setKey('');
      const target = new URLSearchParams(location.search).get('returnTo');
      let destination = new URL('/app', location.origin);
      try {
        destination = new URL(target || '/app', location.origin);
      } catch {
        /* Use the default. */
      }
      location.assign(
        destination.origin === location.origin
          ? destination.pathname + destination.search + destination.hash
          : '/app',
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Sign-in failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Layout title={title}>
      {needsKey && (
        <p>
          In the Cloudflare Dashboard, open this Worker’s <strong>DB</strong> binding, then the{' '}
          <strong>admin_keys</strong> table. Copy <code>secret_display</code> for{' '}
          <code>{purpose}</code>. It is never shown by this website.
        </p>
      )}
      {purpose === 'recovery' && (
        <p>
          After a successful replacement, previous Passkeys, sessions and MCP authorizations stop
          working. The replacement recovery key will be available only in D1.
        </p>
      )}
      <form onSubmit={submit} aria-busy={busy}>
        {needsKey && (
          <label>
            Owner {purpose === 'bootstrap' ? 'claim' : 'recovery'} key
            <input
              type="password"
              autoComplete="off"
              required
              value={key}
              onChange={(e) => setKey(e.target.value)}
              disabled={busy}
            />
          </label>
        )}
        {purpose === 'bootstrap' && (
          <label className="check">
            <input
              type="checkbox"
              required
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              disabled={busy}
            />{' '}
            Use <code>{origin}</code> as this deployment’s permanent Passkey and OAuth address.
          </label>
        )}
        <button disabled={busy}>
          {busy ? 'Waiting for Passkey…' : registration ? 'Register Passkey' : 'Use Passkey'}
        </button>
      </form>
      <p role="status" aria-live="polite">
        {status}
      </p>
      <p>
        <a href="/login">Sign in</a> · <a href="/recover">Recovery instructions</a>
      </p>
      <noscript>Enable JavaScript to use Passkeys.</noscript>
    </Layout>
  );
}

type Grant = { id: string; clientId: string; scope: string[]; createdAt: number };
function Connections() {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [status, setStatus] = useState('Loading applications…');
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    void (async () => {
      try {
        const items: Grant[] = [];
        let cursor: string | undefined;
        do {
          const response = await fetch(
            '/api/grants' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''),
            { signal: abort.signal },
          );
          if (!response.ok)
            throw new Error('Could not load applications. Sign in again and retry.');
          const page = (await response.json()) as { items: Grant[]; cursor?: string };
          items.push(...page.items);
          cursor = page.cursor;
        } while (cursor);
        if (!abort.signal.aborted) {
          setGrants(items);
          setStatus(items.length ? '' : 'No connected applications.');
        }
      } catch (error) {
        if (!abort.signal.aborted)
          setStatus(error instanceof Error ? error.message : 'Could not load applications.');
      }
    })();
    return () => abort.abort();
  }, []);
  async function revoke(id: string) {
    setPending(id);
    setStatus('');
    try {
      await post('/api/grants/revoke', { grantId: id });
      setGrants((values) => values.filter((value) => value.id !== id));
      setStatus('Application access revoked.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Revocation failed.');
    } finally {
      setPending(null);
    }
  }
  return (
    <Layout title="Connected applications">
      <p>
        Only applications you explicitly approve can use MCP. Revoking one does not sign you out of
        the Web App.
      </p>
      <ul>
        {grants.map((grant) => (
          <li key={grant.id}>
            <p>
              <strong>{grant.clientId}</strong>
              <br />
              {grant.scope.join(', ')}
            </p>
            <button disabled={pending !== null} onClick={() => void revoke(grant.id)}>
              {pending === grant.id ? 'Revoking…' : 'Revoke'}
            </button>
          </li>
        ))}
      </ul>
      <p role="status">{status}</p>
      <p>
        <a href="/login?returnTo=%2Fsettings%2Fconnected-apps">Sign in again</a> ·{' '}
        <a href="/app">Back to whiteboard</a>
      </p>
    </Layout>
  );
}

function Consent({ data }: { data: ConsentData }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const values = new FormData(form);
    values.set('decision', submitter?.value ?? 'deny');
    setBusy(true);
    setStatus('');
    try {
      const response = await fetch('/authorize', {
        method: 'POST',
        body: new URLSearchParams(
          [...values.entries()].map(([key, value]) => [key, String(value)]),
        ),
      });
      const result = (await response.json()) as {
        redirectTo?: string;
        error?: string;
        message?: string;
      };
      if (!response.ok || !result.redirectTo)
        throw new Error(result.message || result.error || 'Authorization failed');
      // This URL comes only from the server after the SDK validates the consent transaction.
      location.assign(result.redirectTo);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Authorization failed');
      setBusy(false);
    }
  }
  return (
    <Layout title="Authorize application">
      <p>
        <strong>{data.clientName}</strong> requests access to your whiteboard.
      </p>
      <p>
        {data.clientDomain ? (
          <>
            Client domain: <strong>{data.clientDomain}</strong>
          </>
        ) : (
          'Self-registered client; its name is not verified.'
        )}
      </p>
      <p>
        Redirect destination: <strong>{data.redirectHost}</strong>
        {data.redirectIsLoopback &&
          ' — an application on your computer. Only continue if you started this connection.'}
      </p>
      <p>
        Resource: <code>{data.resource}</code>
      </p>
      <form onSubmit={submit} aria-busy={busy}>
        <input type="hidden" name="handle" value={data.handle} />
        {data.scopes.map((scope) => (
          <label className="check" key={scope}>
            <input
              type="checkbox"
              name="scope"
              value={scope}
              defaultChecked
              disabled={busy || scope === 'mcp:read'}
            />
            {scope === 'mcp:read' && <input type="hidden" name="scope" value={scope} />} {scope}
            {scope === 'mcp:read' ? ' (required)' : ''}
          </label>
        ))}
        <div className="actions">
          <button name="decision" value="approve" disabled={busy}>
            Allow
          </button>
          <button className="secondary" name="decision" value="deny" disabled={busy}>
            Deny
          </button>
        </div>
      </form>
      <p role="status">{status}</p>
    </Layout>
  );
}

export function AuthPage({ data }: { data: AuthPageData }) {
  if (data.kind === 'passkey') return <PasskeyPage data={data} />;
  if (data.kind === 'connections') return <Connections />;
  return <Consent data={data} />;
}

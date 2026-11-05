import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  SCOPE_LABELS,
  type AuthPageData,
  type ConsentData,
  type PasswordParams,
} from '../../shared/auth';
import { newCredential, stretch } from './password';
import { BRAND_ICON, CopyRow, mcpUrl } from '../design/Copy';

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

export function Layout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="auth-page">
      <div className="auth-card">
        <a className="brand" href="/app">
          <img src={BRAND_ICON} alt="" />
          InkLoop
        </a>
        <h1>{title}</h1>
        {children}
      </div>
    </main>
  );
}

function returnToDestination() {
  const target = new URLSearchParams(location.search).get('returnTo');
  let destination = new URL('/app', location.origin);
  try {
    destination = new URL(target || '/app', location.origin);
  } catch {
    /* Use the default. */
  }
  return destination.origin === location.origin
    ? destination.pathname + destination.search + destination.hash
    : '/app';
}

async function params() {
  const response = await fetch('/auth/password');
  const data = (await response.json()) as PasswordParams & { error?: string; message?: string };
  if (!response.ok) throw new Error(data.message || data.error || 'Request failed');
  return data;
}

function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  disabled,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  autoComplete: 'current-password' | 'new-password';
  disabled: boolean;
}) {
  return (
    <label>
      {label}
      <input
        type="password"
        autoComplete={autoComplete}
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
    </label>
  );
}

function PasswordPage({ data }: { data: Extract<AuthPageData, { kind: 'password' }> }) {
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState('');
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const { purpose, initialized, origin } = data;
  if (purpose === 'setup' && initialized)
    return (
      <Layout title="Already set up">
        <p>This deployment already has an owner.</p>
        <a href="/login">Sign in</a>
      </Layout>
    );
  const needsKey = purpose === 'setup' || purpose === 'recovery';
  const choosing = purpose !== 'login';
  const title = {
    setup: 'Set up your whiteboard',
    recovery: 'Reset your password',
    change: 'Change password',
    login: 'Sign in',
  }[purpose];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setStatus('');
    try {
      if (purpose === 'setup' && !confirmed)
        throw new Error('Confirm your deployment address first.');
      if (choosing && password !== repeat) throw new Error('The two passwords do not match.');
      if (purpose === 'login') {
        await post('/auth/login', { derived: await stretch(password, await params()) });
      } else if (purpose === 'change') {
        await post('/auth/password', {
          current: await stretch(current, await params()),
          password: await newCredential(password),
        });
        setCurrent('');
        setPassword('');
        setRepeat('');
        setStatus('Password changed. Other devices were signed out.');
        return;
      } else {
        await post(purpose === 'setup' ? '/auth/setup' : '/auth/recover', {
          key,
          canonicalOrigin: origin,
          password: await newCredential(password),
        });
      }
      setKey('');
      setPassword('');
      location.assign(returnToDestination());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const keyName = purpose === 'setup' ? 'claim' : 'recovery';
  const query = `SELECT secret_display FROM admin_keys WHERE purpose = '${
    purpose === 'setup' ? 'bootstrap' : 'recovery'
  }';`;
  const passwordFields = (
    <>
      {purpose === 'change' && (
        <PasswordField
          label="Current password"
          value={current}
          onChange={setCurrent}
          autoComplete="current-password"
          disabled={busy}
        />
      )}
      <PasswordField
        label={choosing ? 'New password' : 'Password'}
        value={password}
        onChange={setPassword}
        autoComplete={choosing ? 'new-password' : 'current-password'}
        disabled={busy}
      />
      {choosing && (
        <>
          <PasswordField
            label="Repeat the new password"
            value={repeat}
            onChange={setRepeat}
            autoComplete="new-password"
            disabled={busy}
          />
          <p className="hint">
            Any password works. A longer one, such as a few unrelated words, is much harder to
            guess.
            {password && password.length < 8 && ' This one is short.'}
          </p>
        </>
      )}
    </>
  );

  return (
    <Layout title={title}>
      {purpose === 'setup' && (
        <p>Claim this deployment as its owner. It takes a minute and only happens once.</p>
      )}
      {purpose === 'recovery' && (
        <p className="facts">
          Resetting the password signs out every device and disconnects every AI app. Afterwards the
          recovery key is replaced by a new one, again stored only in D1.
        </p>
      )}
      <form onSubmit={submit} aria-busy={busy}>
        {/* Lets password managers save the password for this deployment. */}
        <input type="text" name="username" autoComplete="username" value="owner" readOnly hidden />
        {needsKey ? (
          <ol className="steps">
            <li>
              <h2>Find your {keyName} key</h2>
              <p>
                It is stored only in this deployment’s Cloudflare D1 database and never shown by
                this website.{' '}
                <a
                  href={data.d1ConsoleUrl ?? 'https://dash.cloudflare.com/?to=/:account/workers/d1'}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open Cloudflare D1
                </a>
                . If a database list appears, choose this instance’s database (usually{' '}
                <code>inkloop-db</code>). On the database overview, click{' '}
                <strong>Explore Data</strong>. In Studio, run:
              </p>
              <CopyRow text={query} />
              <p className="hint">Copy the value shown in the secret_display column.</p>
            </li>
            <li>
              <h2>Paste it here</h2>
              <label>
                {keyName === 'claim' ? 'Claim' : 'Recovery'} key
                <input
                  type="password"
                  autoComplete="off"
                  required
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  disabled={busy}
                />
              </label>
            </li>
            <li>
              <h2>{purpose === 'setup' ? 'Choose a password' : 'Choose a new password'}</h2>
              {passwordFields}
            </li>
            {purpose === 'setup' && (
              <li>
                <h2>Confirm this address</h2>
                <label className="check">
                  <input
                    type="checkbox"
                    required
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                    disabled={busy}
                  />
                  <span>
                    Use <code>{origin}</code> as this deployment’s permanent sign-in and AI app
                    address.
                  </span>
                </label>
              </li>
            )}
          </ol>
        ) : (
          passwordFields
        )}
        <button disabled={busy}>
          {busy
            ? purpose === 'login'
              ? 'Signing in…'
              : 'Saving…'
            : {
                setup: 'Set up InkLoop',
                login: 'Sign in',
                recovery: 'Reset password',
                change: 'Change password',
              }[purpose]}
        </button>
      </form>
      <p role="status" aria-live="polite">
        {status}
      </p>
      <p className="foot">
        {purpose === 'change' ? (
          <a href="/app">Back to whiteboard</a>
        ) : (
          <>
            {purpose !== 'login' && (
              <>
                <a href="/login">Sign in</a>
                {purpose !== 'recovery' && ' · '}
              </>
            )}
            {purpose !== 'recovery' && <a href="/recover">Forgot your password?</a>}
          </>
        )}
      </p>
      <noscript>Enable JavaScript to sign in.</noscript>
    </Layout>
  );
}

type Grant = { id: string; clientId: string; scope: string[]; createdAt: number };
/** A CIMD client ID is a URL; its host names the app better than the whole address. */
const appName = (clientId: string) => {
  try {
    return new URL(clientId).host;
  } catch {
    return clientId;
  }
};
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
    <Layout title="Connected AI apps">
      <h2>MCP server URL</h2>
      <p>
        Add this address to your AI app (Claude, ChatGPT, Codex…) as a remote MCP server. The app
        then asks you to sign in here and approve it.
      </p>
      <CopyRow text={mcpUrl()} />
      <h2 style={{ marginTop: 19.5 }}>Connected</h2>
      <p>
        Only apps you approve can use InkLoop. Revoking one does not sign you out of the whiteboard.
      </p>
      {grants.length > 0 && (
        <ul className="rows">
          {grants.map((grant) => (
            <li key={grant.id}>
              <p>
                <strong>{appName(grant.clientId)}</strong>
                <small>
                  {grant.scope.map((scope) => SCOPE_LABELS[scope] ?? scope).join(' · ')}
                </small>
              </p>
              <button
                className="secondary small"
                disabled={pending !== null}
                onClick={() => void revoke(grant.id)}
              >
                {pending === grant.id ? 'Revoking…' : 'Revoke'}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p role="status">{status}</p>
      <p className="foot">
        <a href="/app">Back to whiteboard</a> ·{' '}
        <a href="/login?returnTo=%2Fsettings%2Fconnected-apps">Sign in again</a>
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
    <Layout title="Connect an AI app">
      <p>
        <strong>{data.clientName}</strong> wants to use your whiteboard.
      </p>
      <div className="facts">
        <p>
          {data.clientDomain ? (
            <>
              App: <strong>{data.clientDomain}</strong>
            </>
          ) : (
            'Self-registered app; its name is not verified.'
          )}
        </p>
        <p>
          Returns to: <strong>{data.redirectHost}</strong>
          {data.redirectIsLoopback &&
            ' (an app on your computer; only continue if you started this connection)'}
        </p>
        <p>
          Server: <code>{data.resource}</code>
        </p>
      </div>
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
            {scope === 'mcp:read' && <input type="hidden" name="scope" value={scope} />}
            <span>
              {SCOPE_LABELS[scope] ?? scope}
              {scope === 'mcp:read' ? ' (required)' : ''} <code>{scope}</code>
            </span>
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
  if (data.kind === 'password') return <PasswordPage data={data} />;
  if (data.kind === 'connections') return <Connections />;
  return <Consent data={data} />;
}

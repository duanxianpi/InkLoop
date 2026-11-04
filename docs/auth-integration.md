# Authentication

InkLoop uses one Hono application as the Worker's fetch handler. Authentication is a set of middleware and handlers within that route tree; it is not an outer application dispatcher. The original OAuth integration (and the Passkey sign-in it has since replaced) was adapted from [self-hosted-mcp-auth](https://github.com/duanxianpi/self-hosted-mcp-auth).

## Routing and policy

`src/server/index.ts` owns the top-level routes. `src/server/middleware.ts` provides canonical-origin checks, authentication rate limiting, session checks, mutation CSRF checks and response security headers.

| Route                                                     | Handler and access                                                                                               |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `/setup`, `/login`, `/recover`                            | Public React SPA shell; setup is rate limited and initializes the bootstrap key only before owner initialization |
| `/`, `/app`, `/settings/*` (registered pages)             | SPA shell after session check; unauthenticated users are redirected to login with a same-origin return path      |
| `GET /authorize`                                          | SPA shell after setup/session checks; preserves the incoming authorization query                                 |
| `/assets/*`                                               | Cloudflare Static Assets serves public files directly, with immutable caching; no Worker/D1 request              |
| `GET /api/status`                                         | Public initialized flag only                                                                                     |
| `GET /auth/password`                                      | Public salt and iteration count for the owner password                                                           |
| `POST /auth/setup`, `/auth/login`, `/auth/recover`        | Password setup (claim key), sign-in and reset (recovery key), with Origin checks                                 |
| `POST /auth/password`                                     | Session-protected password change; requires the current password                                                 |
| `POST /auth/consent`                                      | Session/CSRF-protected preparation of an OAuth consent transaction                                               |
| `POST /authorize`                                         | Session/CSRF-protected approval or denial; returns SDK-validated `redirectTo` as JSON                            |
| `/oauth/*`, `/.well-known/*`, `/mcp`                      | Explicitly forwarded to the OAuth SDK, which authenticates `/mcp` before the MCP endpoint dispatches a tool      |
| `/api/me`, `/api/grants`, `/api/grants/revoke`, `/logout` | Authenticated account operations; mutations require matching Origin                                              |
| Remaining `/api/*`                                        | Authenticated Hono product router; mutations require matching Origin                                             |

Unregistered URLs return 404, rather than silently becoming SPA pages. `/index.html` is an internal asset lookup, not an alternative public page route. Private API requests return 401 rather than HTML redirects.

Product writes must recheck the auth epoch inside the database operation. A request authorized before recovery must not commit afterward merely because its initial check passed. Every product write batch starts with a `write_guards` row whose trigger aborts the whole batch when the epoch changed.

## React SPA

`src/web/main.tsx` mounts the application with `createRoot`. `App.tsx` chooses the page from `src/shared/pages.ts`, which also registers Hono page routes. Account components live in `src/web/auth/`; the product board is a separately loaded chunk in `src/web/board/`.

Every registered page receives the same static `index.html`. Vite builds ordinary hashed JavaScript and CSS under `dist/public/assets/`. There is no server React rendering, hydration, injected page data, dedicated `auth.js`, or script inlining.

Password pages request `/api/status` and `/auth/password`, stretch the password in the browser and post only the result. Connected-app pages load and revoke grants through authenticated APIs.

The shell and static JavaScript contain no private owner data. Page access checks improve navigation behavior; the actual security boundary is server authentication and authorization on every private operation. The page CSP permits same-origin scripts, styles and API connections and prohibits inline scripts. React renders untrusted client names as text.

## OAuth consent flow

1. The client sends the browser to `/authorize?...`. Hono requires a session, preserving the query through login.
2. React sends that query to `POST /auth/consent` with same-origin credentials.
3. The server uses SDK helpers to validate the client, redirect, requested scopes and resource. It returns display metadata and a consent handle, together with the SDK's consent cookie.
4. React shows that validated context with mandatory `mcp:read` and optional write access. Approve/deny submits the handle and selected scopes to `POST /authorize`.
5. The server verifies the session, Origin and SDK consent transaction, records the grant or denial, and returns the validated destination. React navigates to that URL.

The server rejects approvals without `mcp:read` before consuming the consent handle. Consent handlers reuse the middleware session and Origin checks. The browser never supplies a trusted redirect destination of its own. Invalid or replayed consent transactions fail on the server. SDK helpers are obtained directly through `getOAuthApi`; routing does not pass through a second application dispatcher. The SDK remains responsible for protocol-owned discovery, registration, token and MCP bearer-token handling.

The root router injects the authenticated MCP handler into the OAuth adapter; auth code does not construct product services or tools. OAuth callbacks reuse the current request's auth-state read, with a separate D1 revocation lookup. Authorization state is never cached across requests. Product writes still need their own transactional epoch guards.

## Owner lifecycle

The owner proves access to a bootstrap key held in D1, confirms the deployment's permanent HTTPS origin and chooses a password. Setup commits in one guarded D1 transaction: the claim key must still be unused and the deployment uninitialized when it commits.

Passwords are the owner's choice; the setup page recommends a longer one but accepts any non-empty password. The browser stretches the password with PBKDF2-SHA256 (600,000 iterations, a random 16-byte salt per password, both stored in `owner_password`) and sends only the 32-byte result. The Worker stores SHA-256 of that result and compares in constant time, so a sign-in costs one hash within the Workers Free CPU budget, while a leaked verifier still costs a full PBKDF2 per offline guess. The algorithm being public does not change that cost. The stretched value is a reusable sign-in credential, equivalent to the password: HTTPS protects it in transit, and it must be kept out of logs and telemetry like a password (the Worker never logs request bodies). Stretching protects the stored verifier; it is not end-to-end encryption, and the whiteboard's data is stored readable by the deployment. Online guessing is limited by the `/auth/*` rate limit and by `login_throttle`: after five consecutive failures each further attempt waits 2, 4, 8… seconds, up to 15 minutes, and a successful sign-in resets it.

Each write that acts on a checked password commits only if that password is still current and the auth epoch is unchanged: a sign-in whose check raced a recovery or password change gets no session, and of two concurrent password changes only the first wins. Changing the password requires the current one and a still-valid session, and ends the owner's other Web sessions; connected AI apps keep working. Recovery with the recovery key sets a new password, rotates the recovery key, increments the auth epoch and invalidates previous Web sessions and MCP authorizations. D1 epoch/revocation checks are authoritative; best-effort OAuth KV cleanup is supplementary. A deployment that used Passkeys before `0005_password.sql` has no password until the owner resets it with the recovery key.

Auth JSON endpoints reject null, arrays and primitives with `400 invalid_request` before reading fields.

Connected-app revocation requires a recent session. It writes a D1 revocation marker before attempting SDK cleanup. Web logout clears the current Web session; it does not revoke independently authorized MCP clients.

## Maintenance and validation

Upstream changes require a reviewed merge and authentication regression checks. Auth migrations `0001`–`0003` and `0005` remain immutable after deployment. Dependencies are pinned in the manifest and lockfile.

Local tests cover password setup, sign-in throttling, change and recovery (`tests/password-auth.test.mjs`), commit-time races between those flows against real D1 (`tests/auth-races.test.mjs`), the Hono route tree, public assets, private API/session boundaries, CSRF, consent preparation/approval/denial/replay, PKCE exchange, MCP discovery and epoch invalidation. Browser fixtures check actual SPA rendering and interactions. Deployed product acceptance remains a separate check.

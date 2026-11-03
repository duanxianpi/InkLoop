# Authentication

Whiteboard uses one Hono application as the Worker's fetch handler. Authentication is a set of middleware and handlers within that route tree; it is not an outer application dispatcher. The original Passkey/OAuth implementation was adapted from [self-hosted-mcp-auth](https://github.com/duanxianpi/self-hosted-mcp-auth).

## Routing and policy

`src/server/index.ts` owns the top-level routes. `src/server/middleware.ts` provides canonical-origin checks, authentication rate limiting, session checks, mutation CSRF checks and response security headers.

| Route                                                       | Handler and access                                                                                               |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `/setup`, `/login`, `/recover`                              | Public React SPA shell; setup is rate limited and initializes the bootstrap key only before owner initialization |
| `/`, `/app`, `/settings/*` (registered pages)               | SPA shell after session check; unauthenticated users are redirected to login with a same-origin return path      |
| `GET /authorize`                                            | SPA shell after setup/session checks; preserves the incoming authorization query                                 |
| `/assets/*`                                                 | Cloudflare Static Assets serves public files directly, with immutable caching; no Worker/D1 request              |
| `GET /api/status`                                           | Public initialized flag only                                                                                     |
| `POST /auth/:purpose/options`, `POST /auth/:purpose/finish` | Passkey handlers with Origin, ceremony and purpose-specific proof checks                                         |
| `POST /auth/consent`                                        | Session/CSRF-protected preparation of an OAuth consent transaction                                               |
| `POST /authorize`                                           | Session/CSRF-protected approval or denial; returns SDK-validated `redirectTo` as JSON                            |
| `/oauth/*`, `/.well-known/*`, `/mcp`                        | Explicitly forwarded to the OAuth SDK; MCP then dispatches the registered tools                                  |
| `/api/me`, `/api/grants`, `/api/grants/revoke`, `/logout`   | Authenticated account operations; mutations require matching Origin                                              |
| Remaining `/api/*`                                          | Authenticated Hono product router; mutations require matching Origin                                             |

Unregistered URLs return 404, rather than silently becoming SPA pages. `/index.html` is an internal asset lookup, not an alternative public page route. Private API requests return 401 rather than HTML redirects.

Product writes must recheck the auth epoch inside the database operation. A request authorized before recovery must not commit afterward merely because its initial check passed. These write guards remain part of the pending service implementation.

## React SPA

`src/web/main.tsx` mounts the application with `createRoot`. `App.tsx` chooses the page from `src/shared/pages.ts`, which also registers Hono page routes. Account components live in `src/web/auth/`; the product canvas currently remains an empty entry.

Every registered page receives the same static `index.html`. Vite builds ordinary hashed JavaScript and CSS under `dist/public/assets/`. There is no server React rendering, hydration, injected page data, dedicated `auth.js`, or script inlining.

Passkey pages request `/api/status` and call the existing ceremony APIs. `navigator.credentials.create()` and `get()` run in the browser, and verification remains on the server. Connected-app pages load and revoke grants through authenticated APIs.

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

The owner proves access to a bootstrap key held in D1 and confirms the deployment's permanent HTTPS origin. WebAuthn verification uses that origin and its RP ID. A SQL guard trigger coordinates the ceremony, key generation and auth epoch in the transaction.

Recovery replaces Passkeys, rotates the recovery key, increments the auth epoch and invalidates previous Web sessions and MCP authorizations. D1 epoch/revocation checks are authoritative; best-effort OAuth KV cleanup is supplementary.

Auth JSON endpoints reject null, arrays and primitives with `400 invalid_request` before reading fields. When issuing a challenge, the server removes at most 32 expired challenges in the same D1 batch as the insert, deleting their `auth_operations` foreign-key children first. Unexpired challenges and their replay guards remain intact. Cleanup is opportunistic: an idle deployment may retain expired rows until the next successful options request; new requests drain expired backlog faster than they add challenges.

Connected-app revocation requires a recent session. It writes a D1 revocation marker before attempting SDK cleanup. Web logout clears the current Web session; it does not revoke independently authorized MCP clients.

## Maintenance and validation

Upstream changes require a reviewed merge and authentication regression checks. Auth migrations `0001`–`0003` remain immutable after deployment. Dependencies are pinned in the manifest and lockfile.

Local tests cover the Hono route tree, public assets, private API/session boundaries, CSRF, consent preparation/approval/denial/replay, PKCE exchange, MCP discovery and epoch invalidation. Browser fixtures check actual SPA rendering and interactions. Physical-device Passkey enrollment/recovery and deployed product acceptance remain separate checks.

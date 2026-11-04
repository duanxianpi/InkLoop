# Development and verification

## Commands

Use Node.js 22.12 or later, as required by `package.json`.

```sh
npm ci
npm run format:check
npm run typecheck
npm run build
npm test
```

Build before running tests. Integration tests execute `dist/worker.js` and `dist/public/`; these generated files are ignored. Tests use local Miniflare and need permission to listen on a loopback port. They do not provision or mutate cloud resources.

The current checks cover:

- Worker/Web TypeScript and the browser-only React account components.
- Real local Worker/D1/KV routing, authentication boundaries and epoch invalidation.
- Shared static SPA shell, CSP and private API isolation; real Static Assets routing serves JS before auth tables exist, with immutable cache headers.
- Explicit private cache preservation, setup throttling and pinned local drawing asset completeness.
- Deployment build/migration/publish ordering with injected processes; failures never publish.
- OAuth client registration, protected consent preparation, approval/denial/replay and mandatory read-scope checks, SDK cookie/handle validation, PKCE token exchange and MCP tool discovery.
- Exclusive create destinations, filtered/paginated Web client calls and malformed JSON.
- MCP acceptance of a large valid batch and rejection of oversized requests.
- The official MCP client (`@modelcontextprotocol/client`, a dev dependency only) connecting to the hand-rolled endpoint and calling every tool; JSON-RPC and transport edge cases; plain input validators agreeing with the zod schemas.
- Auth object-shape rejection and bounded expired-challenge cleanup, including foreign keys and preservation of active replay guards.
- Shared streamed body limits, media-type casing, invalid UTF-8 and empty/oversized OAuth requests, including requests without `Content-Length`.
- Matching HTTP/MCP application error codes for authorization and service failures.

- Product persistence against local workerd, D1, R2 and the ChangeHub (`tests/product.test.mjs`, through `tests/fixtures/product-worker.ts`, which bypasses only OAuth): idempotent creation, optimistic canvas saves and leftover-object cleanup, streamed Snapshot commits, reuse, Resume epochs, concurrent Mark ready, append-only feedback, derived tiles and trends, storage triggers, stale-epoch rollback, long poll and WebSocket notification.
- Commit-time races in password sign-in and change against real D1 (`tests/auth-races.test.mjs`).
- Browser logic in Node (`tests/web.test.mjs`): the save queue's acknowledgement, offline and conflict behaviour, stale drafts keeping their own base; untrusted Markdown and math rendering; status derivation.

These checks do not replace physical-device, deployed or real-client acceptance.

## Account UI preview

After building, run:

```sh
node tests/preview-auth.mjs
```

Open `http://127.0.0.1:4317/setup`, `/login`, `/recover`, `/authorize` or `/settings/connected-apps`. This server binds loopback only and uses synthetic data. It never creates real credentials or connects to an OAuth provider. Password submissions return an explicit preview error; connected-app revocation only changes an in-memory fixture. Stop it with Ctrl-C.

The preview serves the actual built SPA and assets with synthetic API responses. Verify JavaScript rendering, API loading, escaped external text and subsequent interactions.

## Board preview

After building, run:

```sh
node tests/preview-board.mjs
```

and open the printed URL. It runs the real Worker with local D1, R2 and the ChangeHub, seeds sample problems and signs the browser in with a seeded session; nothing is deployed. To act as the agent, append feedback to a problem that has been marked ready:

```sh
node tests/preview-board.mjs feedback <problem_id> partial
```

Rebuild and restart the preview after source changes; its data lives in memory.

## Formatting

Use `npm run format` to apply Prettier and `npm run format:check` to verify formatting. `.prettierrc.json` defines the shared style. `.prettierignore` excludes generated output, local/internal artifacts, the npm lockfile and immutable SQL migrations. Public documentation is formatted with the code.

## Source and contract changes

Keep HTTP and MCP adapters thin. When an MCP tool input changes, change its zod schema in `src/shared/schemas.ts` and the matching validator in `src/server/mcp/input.ts` together; `npm run build` regenerates `src/server/mcp/tools.generated.ts` from the schemas, and the contract test fails if the validator disagrees. Add business invariants to services and storage constraints, with focused tests for data loss, concurrency and authorization boundaries. Keep local recovery and save queues outside presentation components.

Auth code is a local adaptation. Review upstream changes rather than overwriting local React integration or migrations. Preserve the pinned drawing-engine version and native watermark unless a deliberate, separately reviewed change is made.

## Documentation policy

- Public architecture, product requirements, contracts and operational instructions live in `docs/` and are included in version control.
- Local plans, historical evidence, private account references and prototype notes live in ignored `internal/docs/`.
- Credentials, cloud resource state, logs containing private data and backups belong in ignored `.private/` or `.wrangler/`.
- `experiments/` and `prototypes/` remain local development material; public builds and instructions must not require them.
- Delete obsolete instructions when a replacement is adopted. Keep historical evidence only when it answers a specific question, and label its limited scope.
- Public relative links must resolve within publishable files. Do not link to a local template checkout or internal evidence.

Ignoring a path does not remove files already tracked by Git. Inspect the repository's tracked files when adopting this policy in an existing Git checkout; never commit secrets first and rely on `.gitignore` to remove them later.

## Release checks still outstanding

Physical iPad use; deployment with current assets and migrations; real OAuth client image review; Snapshot export quality on dense handwriting; data export/restore; safe orphan-object collection; Cloudflare CPU measurements of the product services.

CPU diagnostics: `npm run perf` reports Node first-method CPU samples separately from correctness tests. These samples are not independent cold isolates or Cloudflare CPU measurements.

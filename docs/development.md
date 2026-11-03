# Development and verification

## Commands

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
- Shared static SPA shell, public hashed assets, CSP and private API isolation.
- OAuth client registration, protected consent preparation, approval/denial/replay checks, SDK cookie/handle validation, PKCE token exchange and MCP tool discovery.
- Exclusive create destinations, filtered/paginated Web client calls and malformed JSON.
- MCP acceptance of a large valid batch and rejection of oversized requests.
- Streamed browser body limits, including requests without `Content-Length`.

Product services remain stubs; these checks do not validate canvas persistence or Snapshot atomicity.

## Account UI preview

After building, run:

```sh
node tests/preview-auth.mjs
```

Open `http://127.0.0.1:4317/setup`, `/login`, `/recover`, `/authorize` or `/settings/connected-apps`. This server binds loopback only and uses synthetic data. It never creates real credentials or connects to an OAuth provider. Passkey submissions return an explicit preview error; connected-app revocation only changes an in-memory fixture. Stop it with Ctrl-C.

The preview serves the actual built SPA and assets with synthetic API responses. Verify JavaScript rendering, API loading, escaped external text and subsequent interactions. Physical-device Passkey ceremonies require a separate HTTPS deployment check.

## Formatting

Use `npm run format` to apply Prettier and `npm run format:check` to verify formatting. `.prettierrc.json` defines the shared style. `.prettierignore` excludes generated output, local/internal artifacts, the npm lockfile and immutable SQL migrations. Public documentation is formatted with the code.

## Source and contract changes

Keep HTTP and MCP adapters thin. Add business invariants to services and storage constraints, with focused tests for data loss, concurrency and authorization boundaries. Keep local recovery and save queues outside presentation components.

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

Product D1 migrations and conditional-commit tests; IndexedDB recovery and save conflicts; full-content PNG export; immutable Snapshot and feedback persistence; live-update loss/reconnect handling; physical iPad/Passkey use; deployment with current assets; real OAuth client image review; data export/restore; safe orphan-object collection.

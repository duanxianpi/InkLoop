# InkLoop

Give your AI a whiteboard.

InkLoop is a self-hosted handwriting surface for AI agents. An agent creates problems through MCP; the owner writes on a persistent canvas, commits an immutable image, and receives feedback attached to that exact submission. The application runs no model and requires no model API key.

**Status: first complete product slice, not yet released.** Password sign-in, OAuth-protected MCP, the four MCP tools, durable problems, canvas autosave, Snapshot commits, append-only feedback, live updates and the handwriting board are implemented and tested locally. Physical-iPad testing, a deployed end-to-end run with a real AI client, data export/restore and orphaned-object collection remain before release.

## Development

```sh
npm ci
npm run format:check
npm run typecheck
npm run build
npm test
```

Tests use local Miniflare/D1/KV/R2 fixtures and do not deploy cloud resources. Build before testing: integration tests execute the generated Worker and assets.

## Architecture

One Cloudflare Worker serves the Web and MCP interfaces. D1 stores structured state, private R2 stores drawing documents and images, KV supports the OAuth SDK, and a ChangeHub Durable Object is reserved for notification-only WebSockets.

- Browser API and MCP tools call the same application service contracts.
- Authentication resolves the owner before product handlers run.
- One React SPA renders account and product pages; Hono serves page shells and routes all APIs; Cloudflare serves public static assets directly with immutable caching.
- A persistent Canvas, immutable Snapshots and append-only Feedback have separate identities and lifecycles.
- Product commits will use D1 as the authoritative boundary; notifications never determine whether a save succeeded.

## Documentation

Start with [the final architecture](docs/architecture.md) or the [documentation index](docs/README.md).

- [Product specification](docs/specification.md)
- [API contracts](docs/api.md)
- [Authentication](docs/auth-integration.md)
- [Deployment and recovery](docs/deployment.md)
- [Development and verification](docs/development.md)

Public documentation lives in `docs/` and is included in source control. Internal plans, historical evidence and prototypes are excluded. Credentials and deployment state stay in ignored `.private/` and `.wrangler/` directories.

# Agent Whiteboard

Give your AI a whiteboard.

Agent Whiteboard is a self-hosted handwriting surface for AI agents. An agent creates problems through MCP; the owner writes on a persistent canvas, commits an immutable image, and receives feedback attached to that exact submission. The application runs no model and requires no model API key.

**Status: architecture foundation.** Passkey authentication, OAuth-protected MCP routing, React account pages, shared contracts and deployment tooling are implemented. The product canvas is an empty React entry; application services and live updates return `not_implemented`. This is not yet a usable handwriting application.

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
- One React SPA renders account and product pages; Hono serves its ordinary built JS/CSS and routes all APIs.
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

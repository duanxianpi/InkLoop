# Documentation

These pages describe the current implementation, product requirements and outstanding release checks. Implementation status was reviewed against source on 2026-11-04; historical measurements describe only their recorded versions.

| Document                                                                         | Purpose                                                                                                     |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| [Architecture](architecture.md)                                                  | Final architecture baseline, module boundaries, data ownership, consistency rules and implementation status |
| [Product specification](specification.md)                                        | Required handwriting, navigation, submission and review behavior                                            |
| [API contracts](api.md)                                                          | Browser routes, MCP tools, limits and errors                                                                |
| [Authentication](auth-integration.md)                                            | Password sign-in, OAuth, React account pages and security boundaries                                        |
| [Deployment](deployment.md)                                                      | Build, provisioning, setup, recovery and upgrade procedure                                                  |
| [Illustrated first setup](getting-started.md) · [中文](getting-started.zh-CN.md) | Deploy success → production URL → D1 Explore Data → claim and password, plus recovery                       |
| [Experiments and performance](experiments/README.md)                             | Production CPU results, historical experiments, audits and their sample data                                |
| [Development](development.md)                                                    | Local checks, UI fixtures, documentation policy and remaining validation                                    |
| [Licensing](licensing.md)                                                        | MIT scope, pinned tldraw requirements, font licenses and redistribution notices                             |

The product specification defines user-visible requirements. Architecture selects the technical implementation. API documentation describes the current code contracts. If behavior changes, update these documents with the code.

Start with the [latest production measurements](experiments/performance-production-2026-11-04.md) for real MCP/D1 CPU evidence. The older Passkey/four-tool/stub reports are historical baselines, not the current implementation. Repeated interactive OAuth authorization observed in the production run remains an [open authentication issue](auth-integration.md#known-deployed-authentication-issue).

`docs/` is the public documentation set. Sanitized experiment reports and their data belong together in `docs/experiments/`. Private planning, prototype decisions and sensitive evidence belong in ignored `internal/docs/`; public pages must not depend on those files. Historical tests do not establish complete production acceptance.

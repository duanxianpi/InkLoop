# Documentation

These pages describe the current foundation and the intended product without treating unimplemented features as available.

| Document                                  | Purpose                                                                                                     |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| [Architecture](architecture.md)           | Final architecture baseline, module boundaries, data ownership, consistency rules and implementation status |
| [Product specification](specification.md) | Required handwriting, navigation, submission and review behavior                                            |
| [API contracts](api.md)                   | Browser routes, MCP tools, limits and errors                                                                |
| [Authentication](auth-integration.md)     | Password sign-in, OAuth, React account pages and security boundaries                                        |
| [Deployment](deployment.md)               | Build, provisioning, setup, recovery and upgrade procedure                                                  |
| [Runtime measurements](performance.md)    | Cloudflare Free-plan CPU measurements, closed audit findings and remaining capacity decisions               |
| [Development](development.md)             | Local checks, UI fixtures, documentation policy and remaining validation                                    |

The product specification defines user-visible requirements. Architecture selects the technical implementation. API documentation describes the current code contracts. If behavior changes, update these documents with the code.

`docs/` is the public documentation set. Local planning, prototype decisions and historical experiment evidence belong in ignored `internal/docs/`; public pages must not depend on those files. Historical prototype tests do not establish that the current production product is complete.

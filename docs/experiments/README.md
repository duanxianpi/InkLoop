# Experiments and performance

Reports and their public sample data live together here. Operational instructions and current contracts remain in the [main documentation](../README.md).

| Report                                                                | Scope                                                                                                   | Status                                                                                                         |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| [Production CPU, 2026-11-04](performance-production-2026-11-04.md)    | Existing deployment; connected OAuth client; real MCP/D1 creation, listing, reads, updates and deletion | Latest product measurements; 36 matched business requests, 12 above 10 ms; repeated reauthorization unresolved |
| [Foundation CPU, 2026-11-03](performance.md)                          | Isolated Passkey foundation; SDK and hand-rolled MCP comparisons; stub services                         | Historical baseline; excludes product persistence                                                              |
| [MCP subset review](mcp-subset-review.md)                             | Four-tool protocol/validator audit and isolated CPU follow-up                                           | Historical review of the measured version; current API has 13 tools                                            |
| [Authentication optimization follow-up](auth-optimization-results.md) | Request-state reuse, Passkey ceremonies and stub MCP performance                                        | Historical implementation; password authentication has replaced Passkeys                                       |

## Sample data

- Production: [matched business requests](performance-production-2026-11-04-samples.csv), [sanitized trace metadata](performance-production-2026-11-04-traces.csv).
- Foundation: [original aggregates](performance-samples.csv), [ten-problem batches](performance-10-problems.csv), [hand-rolled MCP subset](performance-mcp-subset.csv).

Each report defines its environment, sample counts, missing records and cleanup. Compare only equivalent workloads and implementation versions. Node diagnostics, platform CPU and wall time are different measurements; stub persistence is not a benchmark of successful product writes. Small samples and successful overruns do not establish a Free-plan guarantee.

Keep historical findings intact, label their version and scope, and link newer evidence instead of presenting historical implementation descriptions as current. Store credentials, private request bodies and unsanitized logs outside public documentation.

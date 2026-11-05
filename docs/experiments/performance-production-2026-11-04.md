# Deployed production CPU measurements — 2026-11-04

The deployed product still has requests above a 10 ms CPU budget. Single-problem reads, updates and deletion were inexpensive in this sample; listing and problem creation had outliers. Creating 50 problems with 20 KB of text each used 21–39 ms in all three samples.

## Deployment and measurement

- Target: `https://inkloop.duanxianpi.workers.dev`, existing Worker `inkloop`, version `27e2fc39-8e19-44b0-bac3-85bcf9835410`.
- Window: November 4, 2026, approximately 18:58–19:08 America/Toronto (23:58–00:08 UTC). No deployment, subscription or runtime configuration was changed.
- Used the connected InkLoop2 MCP tools with real OAuth authentication and production D1 persistence. Unlike the earlier foundation measurements, creation actually stored problems.
- Captured Cloudflare `cpuTime`, `wallTime`, outcome, version, HTTP status and request length using `wrangler tail inkloop --format json`. CPU is platform execution time, not client round-trip latency.
- Collected 36 successful timed business-tool calls, with one matching business-request CPU record for every call. Calls were sequential, with at least 1.1 seconds between calls; connector/network overhead increased actual spacing. Four additional connector attempts returned an authentication/retry prompt and are excluded from the business timing table, not counted as successful measurements.
- Each successful timed call had four `/mcp` trace records: HTTP 400, 200, 202, then the HTTP 200 business request. The first three are connector negotiation traffic and excluded from the business table. The final record was associated by the nonoverlapping call time interval, order and request length; all create lengths agree with their payload size. JSON-RPC request bodies/methods were not logged, so this is correlation rather than server-side method instrumentation. Do not describe the preliminary 400 responses as CPU-limit failures.
- All 36 matched business invocations returned HTTP 200, tool success and platform outcome `ok`. The broader capture contains 407 records including background browser requests, OAuth and internal activity: 406 `ok`, one `canceled`. No captured invocation had `exceededCpu`. Background records are not used as scenario measurements.

[Matched samples](performance-production-2026-11-04-samples.csv) and [sanitized trace metadata](performance-production-2026-11-04-traces.csv) retain the evidence. Headers, credentials, URL queries, request bodies and client IPs are excluded. Dynamic problem identifiers are removed from trace paths.

## Results

CPU values are milliseconds. Text sizes are ASCII characters per problem. Request bytes include the connector's JSON-RPC envelope. p50 uses nearest rank. Three-sample groups are descriptive; p95 is deliberately omitted.

| Business operation             |   n |   Request bytes | CPU p50 | CPU max | Above 10 ms | CPU samples, in order            |
| ------------------------------ | --: | --------------: | ------: | ------: | ----------: | -------------------------------- |
| List problems in temporary set |  10 |         824–825 |       8 |      23 |        4/10 | 8, 13, 12, 23, 8, 5, 6, 14, 6, 4 |
| Create 1 × 1,000               |   3 |           1,912 |      10 |      18 |         1/3 | 10, 9, 18                        |
| Create 10 × 1,000              |   3 |          11,346 |      15 |      15 |         2/3 | 15, 7, 15                        |
| Create 10 × 5,000              |   3 |          51,346 |       8 |      19 |         1/3 | 8, 19, 6                         |
| Create 10 × 20,000             |   3 | 201,356–201,357 |       8 |      12 |         1/3 | 8, 12, 6                         |
| Create 50 × 20,000             |   3 |       1,003,356 |      24 |      39 |         3/3 | 24, 21, 39                       |
| Get one short problem          |   3 |             815 |       2 |       4 |         0/3 | 4, 2, 2                          |
| Update one short problem       |   3 |             860 |       4 |       9 |         0/3 | 4, 9, 4                          |
| Delete 50 problems             |   4 |           2,194 |       2 |       4 |         0/4 | 4, 3, 2, 2                       |
| Delete remaining 44            |   1 |           2,026 |       3 |       3 |         0/1 | 3                                |

12 of the 36 business requests exceeded 10 ms. Every one still completed successfully. The create groups are small and noisy: their nonmonotonic medians do not establish that larger payloads are cheaper. No CPU profile was taken, so the split between OAuth, JSON handling, persistence, response construction and runtime effects is unknown.

Cloudflare currently documents a 10 ms HTTP CPU allowance for Workers Free, with flexibility for occasional overruns; repeated overruns can terminate execution. Waiting on network or database I/O is excluded from CPU time. Successful overruns here do not establish sustained Free-plan safety. The account's current subscription was not reverified in this run. See [Cloudflare CPU limits](https://developers.cloudflare.com/workers/platform/limits/#cpu-time).

## Authentication reliability observed during the run

The broader capture includes 70 `/oauth/token` requests: 63 HTTP 200 and seven HTTP 400, plus eight successful `POST /authorize` requests. The connector repeatedly asked the owner to authorize again. This was an unresolved integration issue, not an intentional measurement step; business success after retries does not establish reliable unattended operation. The four excluded timed connector attempts above are a narrower count than all token failures in the capture, which also includes setup and cleanup.

The token error response bodies and grant types were not recorded, so refresh failure is a working hypothesis rather than a confirmed error code or root cause. The configured access/refresh lifetimes are 300 seconds / 30 days. See the [authentication issue](../auth-integration.md#known-deployed-authentication-issue) for current context.

## Scope and cleanup

- Created a separate temporary collection and problem set, containing 244 problems in total: one seed, three single-problem creates, nine ten-problem creates and three fifty-problem creates.
- Deleted all 244 through the product's `delete_problems` tool in batches of 50/50/50/50/44; every deletion returned an empty `not_found` list.
- Verified the temporary set returned `problems: []`, then deleted its empty collection (which also removes its empty set).
- Final `list_collections` returned only the original CSC2516 / Week 8 set with 25 problems, matching the pre-test count. Existing problems were not targets of any mutation.
- No handwritten canvas, Snapshot, R2 image upload/download, feedback or password operation was exercised. These results cover the measured MCP/D1 operations, not the complete drawing workflow, deliberate cold-isolate distributions, concurrency or a production SLO. Deletion samples contained no handwriting/images.
- Stopped the real-time tail after cleanup and exported only sanitized evidence. No temporary Cloudflare infrastructure was created.

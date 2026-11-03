# Cloudflare CPU measurements — 2026-11-03

The current foundation **does not have a demonstrated 10 ms CPU budget for every supported request**. Ordinary page/session requests are inexpensive, but MCP discovery has outliers and larger valid MCP bodies exceed 10 ms before product persistence is implemented.

## Method and scope

- Deployed the current Hono/React foundation, including auth object validation and bounded challenge cleanup, to an isolated Cloudflare Worker with separate D1, OAuth KV, R2 and ChangeHub bindings. Production resources were not modified.
- Collected **273 invocation samples** from Cloudflare's `TraceItem.cpuTime` and `wallTime` through a temporary Tail Worker. These are platform CPU/wall measurements, not Miniflare timings or client round-trip estimates. The collector stored only scenario, path, timing and outcome, excluding credentials and request bodies.
- The account is **Workers Free**, confirmed by Cloudflare error `100328` when attempting to configure `limits.cpu_ms`. That configuration was rejected, so no custom limit was applied and the repeat samples remained on the same Free configuration. The existing `usage_model: standard` setting alone must not be interpreted as proof of a Paid subscription.
- Requests ran sequentially from one client; all 207 requests in the main run reported the YYZ ingress colo. The main 207-request run included actual bootstrap, ES256 WebAuthn registration/assertion verification, login, consent, PKCE code exchange, refresh, recovery, authenticated pages and MCP. Credentials were generated in software; this does not certify browser/device Passkey UX.
- Follow-up runs exercised additional body sizes and repeated cleanup. Their temporary Web session was seeded in the isolated test database, followed by the real OAuth consent/token flow. MCP bearer-token validation was not bypassed.
- Product services still return `not_implemented`. MCP measurements include authentication, protocol handling, schema validation and stub dispatch, **not future product database/R2 operations**. Full drawing/export, concurrent load, geographic variability and deliberate cold-isolate distributions are outside this measurement.
- An initial 207-request functional run preceded complete instrumentation and is excluded from the CPU sample count. No sample was dropped just because it was slow.

[Aggregated samples](performance-samples.csv) include all 273 instrumented invocations. Percentiles use nearest rank; small samples are descriptive, not a production SLO. The integer CPU values are preserved as reported by the platform; a reported zero is not proof of zero computation.

## Results

All values below are **CPU milliseconds**, except the final column. Labels such as `20k` denote ASCII body characters per problem, not total serialized request bytes.

| Scenario                                  | Samples | CPU p50 | CPU p95 | CPU max | Above 10 ms | Wall p50 (ms) |
| ----------------------------------------- | ------: | ------: | ------: | ------: | ----------: | ------------: |
| Public status                             |      30 |       0 |       1 |       1 |           0 |            38 |
| Authenticated session API                 |      30 |       1 |       3 |       3 |           0 |            66 |
| Authenticated HTML page                   |      30 |       1 |       2 |       2 |           0 |            71 |
| Passkey login options                     |      12 |       2 |       2 |       2 |           0 |           101 |
| Passkey login verification                |      12 |       4 |       9 |       9 |           0 |           164 |
| MCP `tools/list`                          |      30 |       4 |      11 |      20 |           2 |            78 |
| MCP `list_problems`, stub service         |      30 |       3 |       7 |       7 |           0 |            70 |
| MCP create: 1 problem × 1k                |      10 |       4 |      11 |      11 |           1 |            71 |
| MCP create: 1 problem × 20k               |      20 |       8 |      51 |      52 |           7 |            81 |
| MCP create: 50 problems × 1k              |      20 |      11 |      14 |      14 |          13 |            83 |
| MCP create: 50 problems × 20k             |      17 |      28 |      48 |      48 |          17 |           126 |
| Maximum escaped batch, approximately 6 MB |       3 |      75 |      83 |      83 |           3 |           244 |
| OAuth refresh                             |       5 |       4 |       5 |       5 |           0 |           553 |

The maximum escaped batch contains 50 bodies of 20,000 U+0001 characters. JSON escaping expands these to approximately 6 MB; it is valid under the current schema and 8 MiB transport limit, but is an adversarial size case rather than representative handwritten-workflow text. The ordinary ASCII 50 × 20k case also exceeded 10 ms in every measured invocation.

The first observed `tools/list` invocation used 20 ms. Other groups also had outliers; no instrumentation proves that each outlier was a cold start. Do not silently remove them from the budget.

Bootstrap options and verification each used 8 ms in their single samples. Initial setup used 11 ms. Recovery verification used 11–22 ms across three samples, including best-effort grant cleanup; cost depends on the number of grants. These counts are too small to establish stable tail latency.

The cleanup path deleting 32 expired challenges used 24 ms in its initial single sample, then 2–3 ms in five separately seeded repeats. The complete route was measured, not an isolated SQL statement. Unexpired replay guards and foreign-key ordering are covered by local D1 regression tests; remote checks confirmed expired-row removal and `400` responses for null auth JSON.

## Interpretation

Cloudflare defines CPU time as active execution; waiting for D1/KV/network I/O does not count. Thus a 553 ms OAuth-refresh wall time with 4 ms median CPU is not approaching a 553 ms CPU budget. The Free HTTP CPU allowance is 10 ms, with flexibility for occasional overruns. All 273 sampled invocations had platform outcome `ok`, including those above 10 ms; this demonstrates successful finite test runs, **not guaranteed sustained Free-plan capacity**. See [Cloudflare CPU limits and monitoring](https://developers.cloudflare.com/workers/platform/limits/#cpu-time).

Worker startup validation is a separate measurement: deployment reported 74–111 ms startup time. It must not be compared directly with the per-request 10 ms limit.

Development can continue on the selected architecture, but a strict Free-tier commitment is not currently supported by evidence. Before promising it, profile MCP schema/response construction and large-body parsing, choose a measured batch/body budget, and repeat the same remote scenarios after implementing persistence. Retaining the current maximum batch contract may require a Paid runtime budget; no subscription was changed during this test.

All temporary test Workers and their D1/KV/R2 resources are removed after evidence export. The maintained default configuration does not enable the temporary Tail collector or change CPU limits.

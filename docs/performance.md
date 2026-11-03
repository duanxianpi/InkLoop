# Cloudflare CPU measurements — 2026-11-03

The current foundation **does not have a demonstrated 10 ms CPU budget for every supported request**. Ordinary page/session requests are inexpensive, but MCP discovery has outliers and larger valid MCP bodies exceed 10 ms before product persistence is implemented.

## Audit closure and development decision

The two remaining auth findings are fixed in commit `6f279b8`:

| Finding                                              | Result                                                                                                                                                   | Verification                                                                                                                      |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Expired WebAuthn challenges accumulated indefinitely | Each successful options request removes at most 32 expired challenges, deleting dependent operations first, in the same transaction as the new challenge | Local D1 checks cover batch bounds, foreign keys and preservation of unexpired replay guards; remote D1 readback confirms removal |
| JSON `null` caused auth handlers to return 500       | Auth JSON endpoints require an object and reject null, arrays and primitives with `400 invalid_request`                                                  | Local route regression checks and remote null-body requests                                                                       |

Prettier, Worker/Web TypeScript, build and all 12 automated tests pass. Test cases were extended within the existing integration suite. No production resource or account subscription was changed. Cleanup verification found no remaining test Worker, Tail Worker, D1 database, KV namespace, R2 bucket or Durable Object namespace.

The architecture is ready for product implementation. A guarantee that every supported request fits Workers Free is **not** ready. These are separate acceptance decisions: continue with the selected Hono/service boundaries, while treating CPU capacity as an unresolved operating constraint.

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

## Next verification steps

1. Profile the measured MCP paths before selecting an optimization. Per-request schema construction, tool discovery serialization and body parsing are candidates, not established causes of the outliers.
2. Benchmark representative create batches and drawing documents after persistence exists. Include body bytes, result size, CPU percentiles and failures; an 8 MiB admission limit alone does not establish a CPU-safe workload.
3. If Free operation is a requirement, select and validate smaller request/batch limits against that requirement. Otherwise, retain the product contract and evaluate the required runtime budget. This test did not choose or purchase a plan.
4. Repeat remote checks after meaningful transport, schema or storage changes. Keep physical-device Passkey acceptance and first-install/upgrade testing as separate release checks.

## Follow-up: batches of 10 problems

A separate isolated deployment tested 10 problems per request with ASCII bodies of 1,000, 5,000 and 20,000 characters per problem (approximately 10, 50 and 200 KB of body text per batch, plus JSON framing). Cloudflare rejected the Tail Worker binding on this follow-up with Paid-plan requirement `100150`; Wrangler real-time logs provided the platform `cpuTime` and `wallTime` fields instead. No plan was changed.

The complete follow-up sent one request per second, collected every invocation, and used a fresh synthetic Web session followed by real OAuth consent/token exchange. Each MCP request passed bearer authentication and schema validation before reaching the unchanged service stub. All 60 requests returned HTTP 200 with the expected `not_implemented` tool result and platform outcome `ok`.

| Per-problem body        | Samples | CPU p50 | CPU p95 | CPU max | Above 10 ms |
| ----------------------- | ------: | ------: | ------: | ------: | ----------: |
| 1,000 ASCII characters  |      20 |    6 ms |    9 ms |   10 ms |        0/20 |
| 5,000 ASCII characters  |      20 |    7 ms |   13 ms |   14 ms |        3/20 |
| 20,000 ASCII characters |      20 |   10 ms |   15 ms |   16 ms |        6/20 |

[Follow-up aggregates](performance-10-problems.csv) are separate from the original 273 samples. A preceding faster run sent 60 MCP requests but yielded only 18 MCP timing records: 13 for the 1k group, three for 5k, and two for 20k. Its observed CPU maximum was 45 ms. It is retained as incomplete evidence, excluded from the complete-run percentile table, and prevents interpreting that table's maxima as absolute bounds; the analysis below explains why its spikes matter. Another collection attempt used a rejected Wrangler sampling argument and yielded no CPU samples; its HTTP results were not used as timing evidence.

Ten short problems fit the 10 ms budget in the complete low-rate sample, but larger bodies still exceeded it. This is a finite sample with stub persistence, not a promise that a batch-size cap of 10 makes every request safe on Workers Free. Non-ASCII text and JSON escaping can change byte size and processing cost even at the same character count.

### Analysis across all runs

Both follow-up runs ran the same script version (`6a0274bf`). The faster run started about 90 seconds after deployment; the complete run started three minutes later. The CPU cost separates into two independent components.

**Warm, size-dependent cost.** Warm medians are consistent with roughly 4–5 ms of fixed MCP cost (bearer validation, D1 grant checks, protocol handling), about 0.13 ms per problem object and about 0.02 ms per KB of body text (about 20 ms per MB):

| Batch (warm runs)     | Approximate body | Observed p50 | Estimate |
| --------------------- | ---------------: | -----------: | -------: |
| 10 × 1k               |            10 KB |         6 ms |     6 ms |
| 10 × 5k               |            50 KB |         7 ms |     7 ms |
| 10 × 20k              |           200 KB |        10 ms |    10 ms |
| 50 × 1k               |            50 KB |     11–12 ms |    12 ms |
| 50 × 20k (12 samples) |             1 MB |        28 ms |    31 ms |

This is a rough fit to medians, not a profile. It indicates that the problem count matters as well as body bytes, and that roughly half of the 10 ms budget is consumed before any service work. Persistence, idempotency fingerprints and response construction will add CPU to this baseline.

**Size-independent spikes after deployment or idle time.** The largest outliers do not follow body size:

| Run                     | Preceding condition     | Spike                                 | Same group, warm |
| ----------------------- | ----------------------- | ------------------------------------- | ---------------: |
| Original, first MCP use | Fresh deployment        | `tools/list` 20 ms                    |         p50 4 ms |
| Original, `extra`       | 70.9 s idle             | Auth 26 ms, then 1 × 20k create 52 ms |        p50 10 ms |
| Original, `free_repeat` | 47.6 s idle             | 1 × 20k create 51 ms                  |         p50 9 ms |
| Follow-up, fast run     | About 90 s after deploy | 10 × 1k creates 34 ms and 45 ms       |         p50 6 ms |

A 1 × 20k body is about 20 KB, so 51–52 ms cannot come from parsing it. In each case the spike falls within the first two requests on a path after deployment or about 45 seconds or more of inactivity, then disappears within the same burst. That pattern is consistent with first execution of the MCP code path in a new or not-yet-optimized isolate. Tail events carry no isolate identifier, so this remains an inference, not a proven cause.

The faster run's 45 ms sample is therefore not merely incomplete evidence. It is the same phenomenon the original run recorded, and it is the **typical** condition for a single-owner deployment: an agent calling MCP a few times per session will usually arrive after an idle period. The warm percentile tables, collected at one request per second, understate the CPU a sparse real user observes on the first calls.

### Implications

- A batch-size or body cap controls only the warm component. Even 10 × 1k batches reached 34–45 ms when they were the first calls after deployment.
- Before choosing limits, measure the first-call cost deliberately: deploy, wait idle intervals such as 1, 5 and 15 minutes, and record the first three MCP calls each time.
- Test whether eager initialization moves the first-call cost out of request CPU. Constructing the MCP server and tool schemas, and exercising one schema parse, at module scope would run during Worker startup, which Cloudflare limits separately from per-request CPU. Whether isolate creation charges global-scope work to the first request must be measured, not assumed.
- Real-time `wrangler tail` delivered 18 of 60 records at sub-second request spacing and all 60 at one request per second. Use the one-per-second pacing for future CPU evidence.

The follow-up's temporary resources were also removed after evidence export.

## Hand-rolled MCP endpoint (local measurement)

The MCP SDK was replaced by a hand-rolled stateless endpoint (`src/server/mcp/handler.ts`) with plain input validators and a build-time `tools/list`. The OAuth SDK still authenticates `/mcp`. Main-thread CPU of the MCP handler alone was measured in Node 24, three fresh processes per version. The reported “cold” values are first calls of each method within a process, not independently cold isolates; warm values are the median of 30 calls. Services were stubs, so no D1 or R2 work is included.

| Request                      | SDK, cold (ms) | Hand-rolled, cold (ms) | SDK, warm p50 (ms) | Hand-rolled, warm p50 (ms) |
| ---------------------------- | -------------- | ---------------------- | ------------------ | -------------------------- |
| `initialize` (first request) | 11.1–13.0      | 1.5–1.7                | 0.13–0.15          | 0.02                       |
| `tools/list`                 | 2.2–3.4        | 0.10–0.12              | 0.36–0.43          | 0.03                       |
| `create_problems` 1×1 KB     | 1.9–3.1        | 0.30–0.36              | 0.13–0.15          | 0.02–0.03                  |
| `create_problems` 50×20 KB   | 1.0–1.8        | 1.1–1.5                | 0.60–0.72          | 0.46–0.49                  |

Node understates the SDK's cost on Cloudflare: Node lets zod compile validators with `new Function`, which workerd forbids. The handler-only local measurements suggest reduced protocol overhead; they do not isolate the remaining cost of parsing, validation and response construction. These figures do not include the OAuth SDK's token validation or the Worker's own cold start. The real Cloudflare follow-up below measures this version, including authentication.

## Hand-rolled MCP endpoint: Cloudflare follow-up

The 2026-11-03 [subset review and remote measurements](mcp-subset-review.md) cover the current working-tree implementation. All 60 ten-problem calls have platform CPU records. For bodies of 1k / 5k / 20k ASCII characters per problem, p50 was 4 / 5 / 10 ms and p95 was 6 / 9 / 11 ms; maxima were 12 / 9 / 13 ms. Six of the 60 calls exceeded 10 ms. All returned the expected service-stub result with platform outcome `ok`.

The three short-batch calls after 65 seconds idle used 8 / 5 / 9 ms. This is one idle follow-up, not proof of cold-isolate behavior or elimination of earlier spikes. Discovery logging was incomplete (17 CPU records for 20 successful calls); create logging was complete. Authentication routes also retained samples above 10 ms. See the linked report for scope, audit findings and [aggregates](performance-mcp-subset.csv).

The subsequent [authentication optimization follow-up](auth-optimization-results.md) records request-state reuse, recovery-only OAuth helpers, regression checks and another real Cloudflare run.

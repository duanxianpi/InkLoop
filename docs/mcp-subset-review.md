# MCP subset review and Cloudflare remeasurement

Reviewed the current working-tree implementation on 2026-11-03. The subset keeps OAuth in the existing SDK and implements only stateless JSON responses for initialization, ping and the four tools. No product source was changed by this review.

## Review findings

### P2: keep machine-specific CPU gates outside the default correctness suite

`tests/mcp-cpu.test.mjs:35–57` makes the normal test pipeline fail if any one Node measurement exceeds 5 ms. That absolute threshold depends on the host CPU/runtime and can fail without a semantic regression. All three requests share one loaded handler and process; only initialize is the first request through the shared code. Module loading is outside the measured interval. These are first-method observations, not three independently cold Worker isolates.

Keep the benchmark as an explicit performance command with recorded environment and samples. Keep protocol, authorization and service-dispatch assertions in the default suite. Do not add a benchmark framework to solve this.

### P3: reject malformed initialization and non-finite request IDs

Two direct reproductions against `src/server/mcp/handler.ts`:

- `initialize` with `params: {}` returns a successful negotiated version despite missing `protocolVersion`, `capabilities` and `clientInfo`.
- The valid JSON number spelling `1e400` parses to JavaScript Infinity. It passes the number-type ID check, then response serialization emits `id: null`, losing request correlation.

A small initialization field guard and `Number.isFinite` for numeric IDs are sufficient. Return invalid-params / invalid-request errors before dispatch. Add one regression for each. No session store or general schema engine is needed for these checks. The required initialization fields are described in the [MCP lifecycle specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle).

## Maintenance assessment

The current scope is reasonable for four stateless tools. The official client integration passes; scope checks occur before mutations, unknown tool names use own-property lookup, request bodies are bounded, and services are constructed lazily for tool calls. JSON-only responses and GET/DELETE rejection fit the selected subset of [Streamable HTTP](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).

Keep the four explicit validators and the existing generated tool list. They duplicate the authoritative Zod constraints, so future contract changes must update both validators and parity tests. Existing parity tests cover selected examples; they are not a proof over every possible input. This maintenance cost is small enough at four tools that a new generic validator/code-generation framework is unnecessary.

Local format, typecheck, build and all 17 tests passed. This review found no demonstrated authorization bypass or reason to restore the general MCP server SDK. The findings above describe the reviewed version. They were subsequently addressed: initialization and numeric IDs are checked, and Node CPU diagnostics run separately via `npm run perf` without an absolute timing gate.

## Cloudflare measurements

Measured the current working tree on an isolated Cloudflare deployment on 2026-11-03, script version `883ceb2b-4243-4429-af24-edcc3748255e`. The deployed bundle and source SHA-256 hashes are retained with internal evidence; the uncommitted implementation is not identified as the previous Git commit. CPU values come from Cloudflare real-time trace `cpuTime`, not local Node, Miniflare or client latency.

Timing includes the full authenticated Worker path, including OAuth and D1 authorization reads. Product services remain stubs: each create request returned HTTP 200 with the expected `not_implemented` tool result. This is an endpoint baseline, not the CPU cost of successfully persisting ten problems.

### Ten-problem comparison

One request at a time, with a one-second pause between requests. Each group contains 20 requests with ten ASCII problem bodies; framing and titles add bytes beyond the body totals. Percentiles use nearest rank. The earlier SDK deployment used the same batch sizes and pacing, but these are separate deployments and runs, not a controlled CPU profile.

| Body per problem  | SDK p50 / p95 | Subset p50 / p95 | Subset max | Subset above 10 ms |
| ----------------- | ------------- | ---------------- | ---------- | ------------------ |
| 1,000 characters  | 6 / 9 ms      | 4 / 6 ms         | 12 ms      | 1/20               |
| 5,000 characters  | 7 / 13 ms     | 5 / 9 ms         | 9 ms       | 0/20               |
| 20,000 characters | 10 / 15 ms    | 10 / 11 ms       | 13 ms      | 5/20               |

All 60 create timing records were received and all platform outcomes were `ok`. The subset improves the observed median for the two smaller payloads and p95 for all three groups. It does **not** establish that every ten-problem request fits within 10 ms: even the smallest group had a 12 ms sample. An `ok` outcome above 10 ms is an observation, not a guaranteed allowance beyond the plan budget. Larger bodies still leave little CPU room for future service work.

### Discovery and idle follow-up

- Initial `initialize`: one sample, 8 ms.
- `tools/list`: 20 HTTP successes, **17 CPU records received**; observed p50 5 ms, p95/max 7 ms. Missing records prevent treating those figures as the distribution of all 20 requests.
- After 65 seconds without test requests, three 10 × 1,000-character calls used **8, 5 and 9 ms**, in order. All three records were received. This single interval did not reproduce the earlier large first-use spikes; it does not prove they are eliminated. There is no isolate identifier or guarantee that an idle interval created a cold isolate.

There were 94 total HTTP observations and 91 platform CPU records, all captured outcomes `ok`. The three missing records are confined to `tools/list`; tail stderr was empty. Do not assume that one-second pacing guarantees complete logging.

The setup/authentication samples are separate from the 60 creates: setup 18 ms, bootstrap options/finish 15/17 ms, login options/finish 5/19 ms, invalid-object rejection 3 ms, OAuth registration 10 ms, consent prepare/approve 12/12 ms, token exchange 14 ms. These are one observation per route, not percentiles. Shrinking MCP does not eliminate the authentication routes' observed budget overruns.

### Evidence and decision

[Subset aggregates](performance-mcp-subset.csv) include requested versus captured counts for every scenario. [Earlier SDK aggregates](performance-10-problems.csv) remain separate. Sanitized per-request CPU records, source hashes and cleanup verification are retained in ignored internal evidence; public reports contain no credentials.

Retain the small subset. Address the two small review findings without adding a generic protocol framework. Treat the CPU reduction as useful headroom, not a Free-plan guarantee. Repeat the actual service path once persistence is implemented; longer idle intervals and repeated fresh deployments remain unmeasured in this run.

The temporary Worker, KV namespace, R2 bucket and D1 database were deleted after evidence export. Cloudflare resource-list checks confirmed that none remained, including the Worker’s Durable Object namespace.

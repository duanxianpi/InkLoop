# Authentication optimization follow-up

> Historical evidence from the 2026-11-03 foundation: Passkey authentication, four MCP tools and stub product services. These descriptions and test counts apply to that measured version, not the current product. Start with the [experiment index](README.md) and [production measurements](performance-production-2026-11-04.md).

Measured on Cloudflare on 2026-11-03, version `fd6aab33-63b9-4af0-9ac2-53d22ed37f6b`. Source hashes and sanitized per-request evidence are retained internally. This deployment uses the current working tree, including pre-existing user edits; it is not a controlled before/after experiment.

## Changes

Passkey options/finish reuse the request middleware state, with a fallback state read for standalone callers. The database transaction trigger still checks the current epoch and ceremony validity. OAuth helpers are constructed for recovery only. Access token TTL remains 300 seconds. MCP initialization validates required fields and numeric IDs must be finite. `npm run perf` reports Node diagnostics separately, without a machine-specific pass/fail threshold.

Typecheck, build and all 17 correctness tests passed. A subsequent integration regression also passed: a ceremony from epoch 3 cannot commit after the database epoch advances to 4. Prettier checks passed.

## Platform CPU observations

114 HTTP observations, 106 CPU records received through Wrangler real-time logs. All received outcomes were `ok`; expected HTTP statuses and stub tool results were checked. Missing records are shown explicitly. Percentiles use nearest rank and describe captured records only.

| Scenario              | Captured / sent | p50 ms | p95 ms | Max ms |
| --------------------- | --------------: | -----: | -----: | -----: |
| setup                 |           1 / 1 |     12 |     12 |     12 |
| bootstrap_options     |           1 / 1 |      8 |      8 |      8 |
| bootstrap_finish      |           1 / 1 |     13 |     13 |     13 |
| login_options         |         10 / 10 |      3 |     16 |     16 |
| login_finish          |          6 / 10 |      8 |     11 |     11 |
| invalid_auth_object   |           1 / 1 |      2 |      2 |      2 |
| oauth_register        |           0 / 1 |      — |      — |      — |
| consent_prepare       |           1 / 1 |      7 |      7 |      7 |
| consent_approve       |           0 / 1 |      — |      — |      — |
| oauth_token           |           1 / 1 |     10 |     10 |     10 |
| subset_initialize     |           0 / 1 |      — |      — |      — |
| subset_tools_list     |         19 / 20 |      3 |      6 |      6 |
| subset_create10_1000  |         20 / 20 |      4 |      8 |     11 |
| subset_create10_5000  |         20 / 20 |      5 |      8 |      9 |
| subset_create10_20000 |         20 / 20 |      7 |     12 |     13 |
| idle_login_options    |           1 / 1 |      3 |      3 |      3 |
| idle_login_finish     |           1 / 1 |      9 |      9 |      9 |
| subset_idle_create10  |           3 / 3 |      5 |      6 |      6 |

Login options CPU sequence was 16, 3, 3, 3, 3, 3, 3, 2, 2, 2 ms. Only six of ten login finish records arrived (10, 8, 9, 5, 11, 6 ms); their positions within the ten requests are not established here. Do not label the first captured record as the first invocation or infer a complete warm distribution.

After 65 seconds idle, login options/finish used 3/9 ms. Subsequent short MCP batches used 5/6/4 ms, but authentication ran first, so these MCP calls are not the first requests after idle. Idle does not establish a fresh isolate.

All 60 create timing records arrived. The three payload groups had p50 4/5/7 ms, p95 8/8/12 ms and maxima 11/9/13 ms. Product persistence is still a stub. These observations do not establish that all routes fit the Free CPU budget, nor attribute variation between deployments to one code change.

Temporary Worker, KV, R2 and D1 resources were deleted. Resource-list checks confirmed no remaining owned resources or Durable Object namespace.

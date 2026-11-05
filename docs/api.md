# API contracts

Hono owns the complete route tree. The authenticated product router is mounted at `/api`; account and OAuth routes are described in [Authentication](auth-integration.md). Response types are defined in `src/shared/model.ts`.

## Browser API

All `/api/*` product routes require the owner session. Mutations require a matching `Origin`; WebSocket upgrades also require same-origin `Origin`.

| Method and route                                                                | Contract                                                                                         |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `GET /api/collections`                                                          | Collection summaries, including sets                                                             |
| `GET /api/problems`                                                             | Filtered page of problem summaries and `next_cursor`                                             |
| `GET /api/problems/:id`                                                         | Problem, submission history and feedback                                                         |
| `GET /api/problems/:id/canvas`                                                  | Stored document body (204 before the first save); revision, epoch, state, fingerprint in headers |
| `PUT /api/problems/:id/canvas?base_revision&edit_epoch&fingerprint&has_content` | Document body, stored verbatim                                                                   |
| `POST /api/problems/:id/submissions?revision&edit_epoch`                        | Base64 PNG text and `Idempotency-Key`; new or reused                                             |
| `POST /api/problems/:id/resume`                                                 | Resume the same canvas; return the current edit epoch                                            |
| `GET /api/snapshots/:id/image`                                                  | Authenticated immutable base64 PNG text                                                          |
| `GET /api/preferences`                                                          | Preferences object                                                                               |
| `PUT /api/preferences`                                                          | Merge keys; `null` removes a key                                                                 |
| `GET /api/changes?since&timeout`                                                | Current counter without `since`; bounded wait otherwise                                          |
| `GET /api/changes/socket`                                                       | Upgrade to notification-only ChangeHub                                                           |

List filters are `collection_id`, `set_id`, `answer_state`, `cursor` and `limit` (1–100). Pass the returned cursor back with the same filters. `src/web/api.ts` accepts these parameters directly. Cursors are opaque to the browser and at most 20 characters; the list is ordered by creation.

JSON writes require `Content-Type: application/json`. A canvas save sends the tldraw document as the body, with `base_revision`, `edit_epoch` and the browser-computed answer `fingerprint` as query parameters. The Worker requires `Content-Length` (411 without it), checks it against the limit and streams the body to R2 without parsing it; `GET` returns the stored body unchanged, with revision, edit epoch and answer state in response headers, so a document that fails to load cannot hide its metadata. Content validity is the browser's responsibility; see [Canvas trust boundary](architecture.md#canvas-trust-boundary). A submission body is the base64 text of the PNG (`text/plain`); an empty body asks to reuse the latest Snapshot, which the service accepts only when the saved content's fingerprint equals that Snapshot's, and otherwise rejects with `invalid_request`. The Worker validates the PNG header and dimensions from the first 32 characters, streams the rest to R2 without decoding it, and rejects the upload (`invalid_request`, nothing stored) if any byte is not base64; see [Snapshot image representation](architecture.md#snapshot-image-representation). The image route returns that stored text unchanged (`text/plain`).

## MCP tools

`/mcp` uses OAuth and stateless Streamable HTTP, protocol version `2025-11-25` (`2025-06-18` is also accepted; the two are identical for this subset). Every request requires `mcp:read`; mutations also require `mcp:write`.

The endpoint is hand-rolled (`src/server/mcp/handler.ts`) rather than built on the MCP SDK, to reduce protocol overhead ([experiment history](experiments/README.md)); the [production measurements](experiments/performance-production-2026-11-04.md) still include requests above 10 ms. It implements `initialize`, `ping`, `tools/list` and `tools/call` and answers every request with a single JSON response. Notifications are acknowledged with `202`. There are no sessions, SSE streams, batches or server-to-client requests: `GET` and `DELETE` return `405`, other methods return JSON-RPC `-32601`, and an unknown `MCP-Protocol-Version` returns `400`. Invalid tool arguments and missing scopes are returned as `isError` tool results with the application error payload, so the model can correct the call. `initialize` returns `instructions` describing the Collection / Problem Set / batch hierarchy. `tools/list` is generated at build time from the zod schemas in `src/shared/schemas.ts`; request-time validation uses plain functions in `src/server/mcp/input.ts`, which tests keep in agreement with those schemas.

| Tool                                      | Input and behavior                                                                                                                                                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `create_problems`                         | Required `request_id`, exactly one of `set_id` or `new_set`, and 1–50 problems. A new set requires exactly one of `collection_id` or `new_collection_title`. Titles never implicitly select existing destinations. |
| `list_problems`                           | The same filtering and pagination contract as the Browser API; no images.                                                                                                                                          |
| `get_submission`                          | `problem_id`, optional `snapshot_id` for an earlier attempt; otherwise the latest committed Snapshot, with a PNG image content block and structured context. Without a Snapshot, returns `status: not_ready`.      |
| `append_feedback`                         | Required `problem_id`, explicit `snapshot_id` and `feedback`; optional verdict, callouts and `idempotency_key`. History is append-only.                                                                            |
| `list_collections`                        | Collections and their Problem Sets with problem counts, including empty sets.                                                                                                                                      |
| `get_problem`                             | One problem: statement, batch, answer state, every Snapshot (no images) and the full feedback history.                                                                                                             |
| `update_problem`                          | Change `title`, `body` or `type` (`null` removes the batch). Handwriting, Snapshots and feedback are kept.                                                                                                         |
| `move_problems`                           | Move 1–50 problems to the end of `set_id` in the given order, optionally setting their batch (`type`); all or nothing, unknown IDs are `not_found`. Handwriting, Snapshots and feedback move with them.            |
| `delete_problems`                         | Permanently delete 1–50 problems with their canvas, Snapshots, feedback and stored objects; unknown IDs are returned in `not_found`. Marked destructive.                                                           |
| `update_problem_set`, `update_collection` | Rename.                                                                                                                                                                                                            |
| `delete_problem_set`, `delete_collection` | Delete only when no problems remain (a collection's empty sets go with it). Marked destructive.                                                                                                                    |

A callout is `{ kind, math?, text }`: `kind` is `correct`, `fix` or `incorrect` (shown green, amber or red in the review card), `math` optionally quotes the step as display LaTeX, and `text` explains it.

`get_submission` streams the stored base64 image into the JSON-RPC response without decoding it, with an exact `Content-Length`. For `get_submission`, `answer_state` and `has_unsubmitted_changes` describe the server-known draft. They cannot describe unsynced strokes on an offline device. Feedback is attached to the supplied Snapshot, never whichever Snapshot happens to be latest at write time. Feedback stays append-only: there is no tool to edit or delete an entry. Deleting a problem (migration `0006`) is the only way its Snapshots and feedback are removed.

Creation retries reuse `request_id`. Feedback retries are deduplicated only when `idempotency_key` is supplied. Service implementations must bind keys to operation scope and input fingerprint, returning `idempotency_conflict` for reuse with different content.

## Request budgets

`src/shared/limits.ts` is authoritative. Limits are not independently hardcoded by each adapter.

| Request                          | Complete body limit                                     |
| -------------------------------- | ------------------------------------------------------- |
| MCP JSON-RPC                     | 8 MiB, including envelope and JSON escaping             |
| Canvas JSON save                 | 4 MiB document body                                     |
| Snapshot image                   | 8 MiB decoded PNG; at most 11,184,812 base64 characters |
| Preferences JSON                 | 16 KiB                                                  |
| Auth/OAuth form or JSON requests | 64 KiB                                                  |

Shared HTTP readers for product and auth routes count actual streamed bytes, including bodies without `Content-Length`, and stop reading at the limit. The MCP endpoint applies the same streamed limit to its whole request before parsing. Schema field limits remain additional constraints: titles 200 characters, problem bodies and feedback 20,000, at most 20 callouts of 4,000 characters, and at most 50 problems per create request. A batch with maximum-length JSON-escaped problem text fits within the MCP envelope budget and is covered by tests.

Long polling is implemented in `src/server/services/changes.ts`, capped at six seconds with a two-second check interval and at most four checks (the six-second route cap permits three delayed checks after the initial read). `src/server/hub.ts` provides WebSocket notifications; `src/web/sync/changeFeed.ts` subscribes, reconciles the counter, periodically rechecks it and falls back to long polling.

## Errors

HTTP returns JSON with stable `error` codes; domain errors may include `message` and recovery details. MCP returns `isError: true` with the error payload. Schema validation failures are rejected at the boundary. Invalid JSON is a 400 client error, and oversized bodies are 413.

Other domain codes include `unauthorized`, `forbidden`, `not_found`, `not_ready`, `revision_conflict`, `canvas_locked`, `edit_epoch_changed`, `idempotency_conflict`, `empty_canvas`, `upload_failed` and `not_implemented`. See `src/shared/errors.ts` for their status mapping.

Application auth failures use the same stable codes (`unauthorized`, `forbidden`, `invalid_request`, etc.) with human-readable `message` fields, mapped in `src/server/http/errors.ts`. SDK protocol endpoints retain OAuth error codes and `error_description`. The Web client treats an aborted request as cancellation, redirects an actual 401 to login, and does not treat malformed successful JSON as a valid save acknowledgment.

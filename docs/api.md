# API contracts

Hono owns the complete route tree. The authenticated product router is mounted at `/api`; account and OAuth routes are described in [Authentication](auth-integration.md). The transport adapters and validation below are implemented. Product service methods currently return `501 not_implemented` over HTTP or an MCP tool error with the same code. The response types describe the implementation target.

## Browser API

All `/api/*` product routes require the owner session. Mutations require a matching `Origin`; WebSocket upgrades also require same-origin `Origin`.

| Method and route                                         | Contract                                                |
| -------------------------------------------------------- | ------------------------------------------------------- |
| `GET /api/collections`                                   | Collection summaries, including sets                    |
| `GET /api/problems`                                      | Filtered page of problem summaries and `next_cursor`    |
| `GET /api/problems/:id`                                  | Problem, submission history and feedback                |
| `GET /api/problems/:id/canvas`                           | Canvas document, revision, edit epoch and answer state  |
| `PUT /api/problems/:id/canvas`                           | `{ base_revision, edit_epoch, document }`               |
| `POST /api/problems/:id/submissions?revision&edit_epoch` | PNG body and `Idempotency-Key`; new or reused Snapshot  |
| `POST /api/problems/:id/resume`                          | Resume the same canvas; return the current edit epoch   |
| `GET /api/snapshots/:id/image`                           | Authenticated immutable PNG content                     |
| `GET /api/preferences`                                   | Preferences object                                      |
| `PUT /api/preferences`                                   | Merge keys; `null` removes a key                        |
| `GET /api/changes?since&timeout`                         | Current counter without `since`; bounded wait otherwise |
| `GET /api/changes/socket`                                | Upgrade to notification-only ChangeHub                  |

List filters are `collection_id`, `set_id`, `answer_state`, `cursor` and `limit` (1–100). Pass the returned cursor back with the same filters. `src/web/api.ts` accepts these parameters directly. Cursors are opaque to the browser; the current schema caps them at 20 characters, so the future repository implementation must fit that contract or revise both together.

JSON writes require `Content-Type: application/json`. Submission bodies require `image/png`; an empty body represents a possible reuse request, which the service must validate against the current content. MIME checking at the route is not PNG validation: the future submission service must validate image bytes and dimensions.

## MCP tools

`/mcp` uses OAuth and Streamable HTTP. Every request requires `mcp:read`; mutations also require `mcp:write`.

| Tool              | Input and behavior                                                                                                                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `create_problems` | Required `request_id`, exactly one of `set_id` or `new_set`, and 1–50 problems. A new set requires exactly one of `collection_id` or `new_collection_title`. Titles never implicitly select existing destinations. |
| `list_problems`   | The same filtering and pagination contract as the Browser API; no images.                                                                                                                                          |
| `get_submission`  | `problem_id`; latest committed Snapshot only, with a PNG image content block and structured context. Without a Snapshot, returns `status: not_ready`.                                                              |
| `append_feedback` | Required `problem_id`, explicit `snapshot_id` and `feedback`; optional verdict, callouts and `idempotency_key`. History is append-only.                                                                            |

For `get_submission`, `answer_state` and `has_unsubmitted_changes` describe the server-known draft. They cannot describe unsynced strokes on an offline device. Feedback is attached to the supplied Snapshot, never whichever Snapshot happens to be latest at write time.

Creation retries reuse `request_id`. Feedback retries are deduplicated only when `idempotency_key` is supplied. Service implementations must bind keys to operation scope and input fingerprint, returning `idempotency_conflict` for reuse with different content.

## Request budgets

`src/shared/limits.ts` is authoritative. Limits are not independently hardcoded by each adapter.

| Request                          | Complete body limit                               |
| -------------------------------- | ------------------------------------------------- |
| MCP JSON-RPC                     | 8 MiB, including envelope and JSON escaping       |
| Canvas JSON save                 | 4 MiB, including revision/epoch/document envelope |
| Snapshot PNG                     | 8 MiB                                             |
| Preferences JSON                 | 16 KiB                                            |
| Auth/OAuth form or JSON requests | 64 KiB                                            |

Product routes count actual streamed bytes, including bodies without `Content-Length`, and stop reading at the limit. The MCP SDK enforces the configured overall budget before tool execution. Schema field limits remain additional constraints: titles 200 characters, problem bodies and feedback 20,000, at most 20 callouts of 4,000 characters, and at most 50 problems per create request. A batch with maximum-length JSON-escaped problem text fits within the MCP envelope budget and is covered by tests.

Long polling is capped at six seconds; the planned service has a two-second check interval and at most four checks. No polling or push implementation exists yet.

## Errors

HTTP returns JSON with stable `error` codes; domain errors may include `message` and recovery details. MCP returns `isError: true` with the error payload. Schema validation failures are rejected at the boundary. Invalid JSON is a 400 client error, and oversized bodies are 413.

Other domain codes include `unauthorized`, `forbidden`, `not_found`, `not_ready`, `revision_conflict`, `canvas_locked`, `edit_epoch_changed`, `idempotency_conflict`, `empty_canvas`, `upload_failed` and `not_implemented`. See `src/shared/errors.ts` for their status mapping.

Auth endpoints retain their own error messages. The Web client treats an aborted request as cancellation, redirects an actual 401 to login, and does not treat malformed successful JSON as a valid save acknowledgment.

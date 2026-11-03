// Stable error codes returned by both the Browser API and MCP tools (implementation plan §3, phase 1).
export const ERROR_STATUS = {
  invalid_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  not_ready: 409,
  revision_conflict: 409,
  canvas_locked: 409,
  edit_epoch_changed: 409,
  idempotency_conflict: 409,
  empty_canvas: 422,
  payload_too_large: 413,
  upload_failed: 502,
  not_implemented: 501,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export class DomainError extends Error {
  constructor(
    public code: ErrorCode,
    message: string = code,
    public details: Record<string, unknown> = {},
  ) {
    super(message);
  }
  get status() {
    return ERROR_STATUS[this.code];
  }
}

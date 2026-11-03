import { DomainError } from '../../shared/errors';

const STATUS_CODES: Record<number, string> = {
  400: 'invalid_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  405: 'method_not_allowed',
  409: 'conflict',
  413: 'payload_too_large',
  414: 'uri_too_long',
  415: 'unsupported_media_type',
  421: 'misdirected_request',
  429: 'rate_limited',
  500: 'internal_error',
  503: 'service_unavailable',
};

export class HttpError extends Error {
  readonly code: string;
  constructor(
    public status: number,
    message: string,
    code = STATUS_CODES[status] ?? 'request_failed',
  ) {
    super(message);
    this.code = code;
  }
}

export function assert(value: unknown, status = 400, message = 'Request rejected'): asserts value {
  if (!value) throw new HttpError(status, message);
}

/** Shared application error contract for HTTP and MCP. OAuth protocol errors stay SDK-owned. */
export function errorPayload(error: unknown): Record<string, unknown> {
  if (error instanceof DomainError)
    return { ...error.details, error: error.code, message: error.message };
  if (error instanceof HttpError) return { error: error.code, message: error.message };
  return { error: 'internal_error' };
}

export function errorResponse(error: unknown): Response {
  const status = error instanceof DomainError || error instanceof HttpError ? error.status : 500;
  return Response.json(errorPayload(error), { status });
}

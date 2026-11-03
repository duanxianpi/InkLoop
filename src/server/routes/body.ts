import { DomainError } from '../../shared/errors';

/** Enforce actual streamed bytes, including requests without a trustworthy Content-Length. */
export async function boundedBytes(request: Request, limit: number): Promise<ArrayBuffer> {
  if (Number(request.headers.get('Content-Length')) > limit) {
    await request.body?.cancel();
    throw new DomainError('payload_too_large');
  }
  const reader = request.body?.getReader();
  if (!reader) return new ArrayBuffer(0);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new DomainError('payload_too_large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

export async function boundedJson(request: Request, limit: number): Promise<unknown> {
  if (
    request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json'
  ) {
    throw new DomainError('invalid_request', 'Content-Type must be application/json');
  }
  const bytes = await boundedBytes(request, limit);
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new DomainError('invalid_request', 'Invalid JSON');
  }
}

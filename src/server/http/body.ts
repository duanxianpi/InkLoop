import { HttpError } from './errors';

/** Enforce actual streamed bytes, including requests without a trustworthy Content-Length. */
export async function boundedBytes(request: Request, limit: number): Promise<ArrayBuffer> {
  if (Number(request.headers.get('Content-Length')) > limit) {
    await request.body?.cancel();
    throw new HttpError(413, 'Request body exceeds the configured limit');
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
        throw new HttpError(413, 'Request body exceeds the configured limit');
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
    throw new HttpError(415, 'Content-Type must be application/json');
  }
  const text = await boundedText(request, limit);
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

export async function boundedText(request: Request, limit: number): Promise<string> {
  const bytes = await boundedBytes(request, limit);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new HttpError(400, 'Invalid UTF-8');
  }
}

/** Auth payloads must be objects before handlers inspect their fields. */
export async function boundedJsonObject(
  request: Request,
  limit: number,
): Promise<Record<string, unknown>> {
  const value = await boundedJson(request, limit);
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new HttpError(400, 'JSON body must be an object');
  return value as Record<string, unknown>;
}

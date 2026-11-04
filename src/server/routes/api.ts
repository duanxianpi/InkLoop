// Same router preset as src/server/index.ts; see the note there.
import { Hono } from 'hono/tiny';
import { boundedJson } from '../http/body';
import { z } from 'zod';
import { DomainError } from '../../shared/errors';
import { LIMITS } from '../../shared/limits';
import { CANVAS_HEADERS, type CanvasMeta } from '../../shared/model';
import {
  commitParams,
  listProblemsInput,
  preferencesInput,
  saveCanvasParams,
} from '../../shared/schemas';
import { errorResponse, HttpError } from '../http/errors';
import { appContext, changeHub, type ServerEnv } from '../env';
import { createServices } from '../services';

// Browser API (§17): transport only. Session authentication and mutation CSRF checks already ran in
// the auth layer; each route validates input against the shared contract and calls a service.

export const api = new Hono<ServerEnv>();
api.use('*', async (c, next) => {
  c.set('services', createServices(appContext(c.env, c.get('user').auth_epoch)));
  await next();
});

api.onError((error, c) => {
  if (error instanceof DomainError || error instanceof HttpError) return errorResponse(error);
  if (error instanceof z.ZodError)
    return c.json({ error: 'invalid_request', issues: error.issues.slice(0, 10) }, 400);
  return c.json({ error: 'internal_error' }, 500);
});
api.notFound((c) => c.json({ error: 'not_found' }, 404));

// Live updates: WebSocket to the ChangeHub. Same-origin only (prevents cross-site WebSocket hijacking).
api.get('/changes/socket', (c) => {
  if (c.req.header('Upgrade')?.toLowerCase() !== 'websocket')
    throw new DomainError('invalid_request', 'WebSocket upgrade required');
  if (c.req.header('Origin') !== new URL(c.req.url).origin)
    throw new DomainError('forbidden', 'Origin rejected');
  const headers = new Headers(c.req.raw.headers);
  headers.set('X-Auth-Epoch', String(c.get('user').auth_epoch));
  return changeHub(c.env).fetch(new Request(c.req.raw, { headers }));
});

// Current change counter, or a bounded long poll (fallback when the WebSocket cannot connect).
api.get('/changes', async (c) => {
  const { since, timeout } = z
    .object({
      since: z.coerce.number().int().min(0).optional(),
      timeout: z.coerce.number().min(0).max(LIMITS.longPollSeconds).default(LIMITS.longPollSeconds),
    })
    .parse(c.req.query());
  return c.json(
    await c.get('services').changes.wait(since ?? null, timeout * 1000, c.req.raw.signal),
  );
});

api.get('/collections', async (c) =>
  c.json({ collections: await c.get('services').problems.collections() }),
);

api.get('/problems', async (c) =>
  c.json(
    await c.get('services').problems.list(
      listProblemsInput.parse({
        ...c.req.query(),
        limit: c.req.query('limit') ? Number(c.req.query('limit')) : undefined,
      }),
    ),
  ),
);

api.get('/problems/:id', async (c) =>
  c.json(await c.get('services').problems.get(c.req.param('id'))),
);

const mediaType = (c: { req: { header(name: string): string | undefined } }) =>
  c.req.header('Content-Type')?.split(';')[0].trim().toLowerCase();

/** Bodies streamed to R2 are budgeted by Content-Length; the runtime enforces that length. */
function streamedLength(request: Request, limit: number): number {
  const length = Number(request.headers.get('Content-Length') ?? NaN);
  if (!Number.isSafeInteger(length) || length < 0)
    throw new HttpError(411, 'Content-Length required', 'length_required');
  if (length > limit) throw new HttpError(413, 'Request body exceeds the configured limit');
  return length;
}

const canvasHeaders = (meta: CanvasMeta) => ({
  [CANVAS_HEADERS.revision]: String(meta.revision),
  [CANVAS_HEADERS.edit_epoch]: String(meta.edit_epoch),
  [CANVAS_HEADERS.answer_state]: meta.answer_state,
  ...(meta.fingerprint ? { [CANVAS_HEADERS.fingerprint]: meta.fingerprint } : {}),
});

// The stored document body, unchanged; 204 before the first save.
api.get('/problems/:id/canvas', async (c) => {
  const { meta, body } = await c.get('services').canvas.get(c.req.param('id'));
  return new Response(body, {
    status: body ? 200 : 204,
    headers: { ...canvasHeaders(meta), ...(body ? { 'Content-Type': 'application/json' } : {}) },
  });
});

api.put('/problems/:id/canvas', async (c) => {
  if (mediaType(c) !== 'application/json')
    throw new HttpError(415, 'Content-Type must be application/json');
  const params = saveCanvasParams.parse(c.req.query());
  const length = streamedLength(c.req.raw, LIMITS.canvasDocumentBytes);
  if (!length || !c.req.raw.body)
    throw new DomainError('invalid_request', 'Canvas document required');
  return c.json(await c.get('services').canvas.save(c.req.param('id'), params, c.req.raw.body));
});

// Mark ready. Body: base64 PNG text exported from `revision`, or empty to reuse the latest Snapshot.
// Retries must reuse the Idempotency-Key.
api.post('/problems/:id/submissions', async (c) => {
  const key = z
    .string()
    .min(1)
    .max(LIMITS.idempotencyKeyLength)
    .parse(c.req.header('Idempotency-Key'));
  const expected = commitParams.parse(c.req.query());
  const length = streamedLength(c.req.raw, LIMITS.snapshotImageBase64);
  if (length && mediaType(c) !== 'text/plain')
    throw new HttpError(415, 'Content-Type must be text/plain');
  const image = length && c.req.raw.body ? { body: c.req.raw.body, length } : null;
  return c.json(
    await c.get('services').submissions.commit(c.req.param('id'), expected, key, image),
  );
});

api.post('/problems/:id/resume', async (c) =>
  c.json(await c.get('services').submissions.resume(c.req.param('id'))),
);

// Stored base64 PNG text, unchanged. Snapshot images are immutable, so private caching is safe.
api.get('/snapshots/:id/image', async (c) => {
  const image = await c.get('services').submissions.image(c.req.param('id'));
  return new Response(image.body, {
    headers: {
      'Content-Type': 'text/plain; charset=us-ascii',
      'Content-Length': String(image.length),
      'Cache-Control': 'private, max-age=31536000, immutable',
    },
  });
});

api.get('/preferences', async (c) => c.json(await c.get('services').preferences.get()));
api.put('/preferences', async (c) =>
  c.json(
    await c
      .get('services')
      .preferences.update(
        preferencesInput.parse(await boundedJson(c.req.raw, LIMITS.preferencesBytes)),
      ),
  ),
);

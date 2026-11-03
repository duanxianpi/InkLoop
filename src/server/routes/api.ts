import { Hono } from 'hono';
import { boundedBytes, boundedJson } from '../http/body';
import { z } from 'zod';
import { DomainError } from '../../shared/errors';
import { LIMITS } from '../../shared/limits';
import {
  commitParams,
  listProblemsInput,
  preferencesInput,
  saveCanvasInput,
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

api.get('/problems/:id/canvas', async (c) =>
  c.json(await c.get('services').canvas.get(c.req.param('id'))),
);

api.put('/problems/:id/canvas', async (c) =>
  c.json(
    await c
      .get('services')
      .canvas.save(
        c.req.param('id'),
        saveCanvasInput.parse(await boundedJson(c.req.raw, LIMITS.canvasDocumentBytes)),
      ),
  ),
);

// Mark ready. Body: the PNG exported from `revision`. Retries must reuse the Idempotency-Key.
api.post('/problems/:id/submissions', async (c) => {
  const key = z
    .string()
    .min(1)
    .max(LIMITS.idempotencyKeyLength)
    .parse(c.req.header('Idempotency-Key'));
  const expected = commitParams.parse(c.req.query());
  if (c.req.header('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'image/png') {
    throw new DomainError('invalid_request', 'Content-Type must be image/png');
  }
  const image = await boundedBytes(c.req.raw, LIMITS.snapshotImageBytes);
  return c.json(
    await c
      .get('services')
      .submissions.commit(c.req.param('id'), expected, key, image.byteLength ? image : null),
  );
});

api.post('/problems/:id/resume', async (c) =>
  c.json(await c.get('services').submissions.resume(c.req.param('id'))),
);

api.get(
  '/snapshots/:id/image',
  async (c) =>
    new Response(await c.get('services').submissions.image(c.req.param('id')), {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'private, max-age=31536000, immutable',
      },
    }),
);

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

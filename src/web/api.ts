import type { ListProblemsInput } from '../shared/schemas';
import type {
  CanvasDocument,
  CanvasState,
  ChangeResult,
  CollectionSummary,
  CommitResult,
  Preferences,
  ProblemDetail,
  ProblemPage,
  ResumeResult,
  SaveCanvasResult,
} from '../shared/model';

// Typed client for the Browser API (src/server/routes/api.ts). Live updates arrive over the WebSocket at
// /api/changes/socket as `ChangeMessage`; `changes` is the catch-up / long-poll fallback.

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public details: Record<string, unknown> = {},
  ) {
    super(code);
  }
  /** No HTTP response: the request may or may not have reached the server. */
  get offline() {
    return this.status === 0;
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: 'same-origin', ...init });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new ApiError(0, 'network_unavailable');
  }
  if (response.status === 401) {
    location.assign('/login');
    throw new ApiError(401, 'unauthorized');
  }
  const data = await response.json().catch(() => {
    throw new ApiError(response.status, 'invalid_response');
  });
  if (!response.ok) throw new ApiError(response.status, data.error ?? 'request_failed', data);
  return data as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const problem = (id: string) => `/api/problems/${encodeURIComponent(id)}`;

export const api = {
  changes: (since: number | null, signal?: AbortSignal) =>
    call<ChangeResult>(since === null ? '/api/changes' : `/api/changes?since=${since}`, { signal }),
  collections: () => call<{ collections: CollectionSummary[] }>('/api/collections'),
  problems: (input: ListProblemsInput = {}) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(input))
      if (value !== undefined) query.set(key, String(value));
    return call<ProblemPage>(`/api/problems?${query}`);
  },
  problem: (id: string) => call<ProblemDetail>(problem(id)),
  canvas: (id: string) => call<CanvasState>(`${problem(id)}/canvas`),
  saveCanvas: (
    id: string,
    body: { base_revision: number; edit_epoch: number; document: CanvasDocument },
  ) => call<SaveCanvasResult>(`${problem(id)}/canvas`, json('PUT', body)),
  commit: (
    id: string,
    expected: { revision: number; edit_epoch: number },
    idempotencyKey: string,
    image: Blob,
  ) =>
    call<CommitResult>(
      `${problem(id)}/submissions?revision=${expected.revision}&edit_epoch=${expected.edit_epoch}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'image/png', 'Idempotency-Key': idempotencyKey },
        body: image,
      },
    ),
  resume: (id: string) => call<ResumeResult>(`${problem(id)}/resume`, { method: 'POST' }),
  snapshotImageUrl: (snapshotId: string) =>
    `/api/snapshots/${encodeURIComponent(snapshotId)}/image`,
  preferences: () => call<Preferences>('/api/preferences'),
  updatePreferences: (values: Preferences) =>
    call<Preferences>('/api/preferences', json('PUT', values)),
};

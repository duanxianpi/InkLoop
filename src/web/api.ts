import type { ListProblemsInput } from '../shared/schemas';
import {
  CANVAS_HEADERS,
  type AnswerState,
  type CanvasMeta,
  type ChangeResult,
  type CollectionSummary,
  type CommitResult,
  type Preferences,
  type ProblemDetail,
  type ProblemPage,
  type ProblemSummary,
  type ResumeResult,
  type SaveCanvasResult,
} from '../shared/model';

// Typed client for the Browser API (src/server/routes/api.ts). Live updates arrive over the WebSocket at
// /api/changes/socket as `ChangeMessage`; `changes` is the catch-up / long-poll fallback.

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public details: Record<string, unknown> = {},
  ) {
    super(typeof details.message === 'string' ? details.message : code);
  }
  /** No HTTP response: the request may or may not have reached the server. */
  get offline() {
    return this.status === 0;
  }
}

async function send(path: string, init: RequestInit = {}): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: 'same-origin', ...init });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new ApiError(0, 'network_unavailable');
  }
  if (response.status === 401) {
    location.assign('/login?returnTo=' + encodeURIComponent(location.pathname));
    throw new ApiError(401, 'unauthorized');
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ApiError(response.status, data.error ?? 'request_failed', data);
  }
  return response;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await send(path, init);
  return (await response.json().catch(() => {
    throw new ApiError(response.status, 'invalid_response');
  })) as T;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const problem = (id: string) => `/api/problems/${encodeURIComponent(id)}`;

export interface StoredCanvas {
  meta: CanvasMeta;
  /** The stored document text, or null before the first save. */
  document: string | null;
}

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
  /** Every page of the list, following next_cursor. */
  async allProblems(input: Omit<ListProblemsInput, 'cursor'> = {}) {
    const problems: ProblemSummary[] = [];
    let cursor: string | undefined;
    do {
      const page = await api.problems({ ...input, cursor, limit: 100 });
      problems.push(...page.problems);
      cursor = page.next_cursor ?? undefined;
    } while (cursor);
    return problems;
  },
  problem: (id: string) => call<ProblemDetail>(problem(id)),
  async canvas(id: string): Promise<StoredCanvas> {
    const response = await send(`${problem(id)}/canvas`);
    const header = (name: string) => response.headers.get(name);
    return {
      meta: {
        revision: Number(header(CANVAS_HEADERS.revision)),
        edit_epoch: Number(header(CANVAS_HEADERS.edit_epoch)),
        answer_state: header(CANVAS_HEADERS.answer_state) as AnswerState,
        fingerprint: header(CANVAS_HEADERS.fingerprint),
      },
      document: response.status === 204 ? null : await response.text(),
    };
  },
  /** The document is sent as the body, stored verbatim; the Worker reads only the query. */
  saveCanvas: (
    id: string,
    params: {
      base_revision: number;
      edit_epoch: number;
      fingerprint: string;
      has_content: boolean;
    },
    document: string,
  ) =>
    call<SaveCanvasResult>(
      `${problem(id)}/canvas?` +
        new URLSearchParams({
          base_revision: String(params.base_revision),
          edit_epoch: String(params.edit_epoch),
          fingerprint: params.fingerprint,
          has_content: params.has_content ? '1' : '0',
        }),
      { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: document },
    ),
  /** `image` is base64 PNG text; null asks the server to reuse the identical latest Snapshot. */
  commit: (
    id: string,
    expected: { revision: number; edit_epoch: number },
    idempotencyKey: string,
    image: string | null,
  ) =>
    call<CommitResult>(
      `${problem(id)}/submissions?revision=${expected.revision}&edit_epoch=${expected.edit_epoch}`,
      {
        method: 'POST',
        headers: {
          'Idempotency-Key': idempotencyKey,
          ...(image ? { 'Content-Type': 'text/plain' } : {}),
        },
        body: image ?? '',
      },
    ),
  resume: (id: string) => call<ResumeResult>(`${problem(id)}/resume`, { method: 'POST' }),
  snapshotImage: async (snapshotId: string) =>
    (await send(`/api/snapshots/${encodeURIComponent(snapshotId)}/image`)).text(),
  preferences: () => call<Preferences>('/api/preferences'),
  updatePreferences: (values: Preferences) =>
    call<Preferences>('/api/preferences', json('PUT', values)),
};

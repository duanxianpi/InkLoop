// Transport-neutral DTOs shared by the Worker (Browser API + MCP) and the web client.

/** Recorded with every canvas document; must match the exact pinned tldraw dependency. */
export const CANVAS_ENGINE = 'tldraw@3.15.6';

export type AnswerState = 'working' | 'ready_for_review';
export type Verdict = 'correct' | 'partial' | 'incorrect';
export type TileState = 'empty' | 'working' | 'ready' | Verdict;
export type Trend = 'improved' | 'regressed' | Verdict;

export interface ProblemSetSummary {
  id: string;
  collection_id: string;
  title: string;
  sort_order: number;
  problem_count: number;
}
export interface CollectionSummary {
  id: string;
  title: string;
  sets: ProblemSetSummary[];
}

export interface SnapshotSummary {
  id: string;
  problem_id: string;
  sequence: number;
  source_revision: number;
  /** Answer fingerprint of the committed content; equal content reuses this Snapshot. */
  fingerprint: string;
  width: number;
  height: number;
  created_at: string;
}

export type CalloutKind = 'correct' | 'fix' | 'incorrect';
export interface Callout {
  kind: CalloutKind;
  math?: string;
  text: string;
}
export interface FeedbackEntry {
  id: string;
  problem_id: string;
  snapshot_id: string;
  verdict: Verdict | null;
  text: string;
  callouts: Callout[];
  created_at: string;
}

export interface ProblemSummary {
  id: string;
  set_id: string;
  set_title: string;
  collection_id: string;
  collection_title: string;
  title: string;
  type: string | null;
  sort_order: number;
  answer_state: AnswerState;
  latest_snapshot_id: string | null;
  latest_snapshot_seq: number;
  /** Effective verdict of the latest Snapshot only; null while it is unreviewed. */
  latest_verdict: Verdict | null;
  tile: TileState;
  trend: Trend | null;
  created_at: string;
}
export interface ProblemPage {
  problems: ProblemSummary[];
  next_cursor: string | null;
}

export interface ProblemDetail extends ProblemSummary {
  body: string;
  edit_epoch: number;
  canvas_revision: number;
  canvas_fingerprint: string | null;
  has_content: boolean;
  has_unsubmitted_changes: boolean;
  /** Ordered by sequence. */
  snapshots: SnapshotSummary[];
  /** Ordered by creation. */
  feedback: FeedbackEntry[];
}

export interface CreateProblemsResult {
  problem_ids: string[];
  set_id: string;
  collection_id: string;
}

/** tldraw StoreSnapshot: `{ store: { [id]: record }, schema }`. Session state (camera, tool) is excluded. */
export interface CanvasDocument {
  store: Record<string, { id: string; typeName: string; [key: string]: unknown }>;
  schema: unknown;
}
/** Sent as response headers with the stored document body, so a body that fails to load cannot hide them. */
export interface CanvasMeta {
  revision: number;
  edit_epoch: number;
  answer_state: AnswerState;
  fingerprint: string | null;
}
export const CANVAS_HEADERS = {
  revision: 'X-Canvas-Revision',
  edit_epoch: 'X-Edit-Epoch',
  answer_state: 'X-Answer-State',
  fingerprint: 'X-Canvas-Fingerprint',
} as const;
export interface SaveCanvasResult {
  problem_id: string;
  revision: number;
  has_content: boolean;
}

export interface CommitResult {
  problem_id: string;
  snapshot: SnapshotSummary;
  reused: boolean;
  answer_state: AnswerState;
}
export interface ResumeResult {
  problem_id: string;
  answer_state: AnswerState;
  edit_epoch: number;
  revision: number;
  resumed: boolean;
}

export interface Question {
  title: string;
  body: string;
  type: string | null;
}
/** get_submission: the latest committed Snapshot, never the live draft. */
export interface Submission {
  status: 'ready';
  problem_id: string;
  snapshot_id: string;
  sequence: number;
  /** Sequence of the latest committed Snapshot; differs from `sequence` for an earlier one. */
  latest_sequence: number;
  created_at: string;
  answer_state: AnswerState;
  has_unsubmitted_changes: boolean;
  question: Question;
  /** Stored base64 PNG text, streamed into the MCP response without decoding. */
  image: { mimeType: 'image/png'; body: ReadableStream<Uint8Array>; length: number };
}
export interface NotReady {
  status: 'not_ready';
  problem_id: string;
  answer_state: AnswerState;
  has_unsubmitted_changes: boolean;
  question: Question;
}

export interface AppendFeedbackResult {
  feedback_id: string;
  problem_id: string;
  snapshot_id: string;
  created_at: string;
}

export type Preferences = Record<string, unknown>;

/** Change counter: bumped by writes that change what pages display; pushed by the ChangeHub. */
export interface ChangeResult {
  seq: number;
  changed: boolean;
}
export interface ChangeMessage {
  type: 'changed';
  seq: number;
}

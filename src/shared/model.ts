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
  created_at: string;
}

export interface Callout {
  label: string;
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
  has_content: boolean;
  has_unsubmitted_changes: boolean;
  snapshots: SnapshotSummary[];
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
export interface CanvasState {
  problem_id: string;
  revision: number;
  edit_epoch: number;
  answer_state: AnswerState;
  document: CanvasDocument | null;
}
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
  created_at: string;
  answer_state: AnswerState;
  has_unsubmitted_changes: boolean;
  question: Question;
  image: { mimeType: 'image/png'; data: string };
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

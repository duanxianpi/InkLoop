import type { AnswerState, FeedbackEntry, TileState, Trend, Verdict } from './model';

// The single source of derived review status (Specification §12, §15.1). list_problems, the
// Overview tiles and the Review card all call these functions; nothing derived here is stored.

export interface DeriveInput {
  answer_state: AnswerState;
  has_content: boolean;
  /** Ordered by sequence. */
  snapshots: readonly { id: string }[];
  /** Ordered by creation. */
  feedback: readonly Pick<FeedbackEntry, 'snapshot_id' | 'verdict'>[];
}

const RANK: Record<Verdict, number> = { incorrect: 0, partial: 1, correct: 2 };

/** The latest graded entry for a Snapshot; a later ungraded comment does not clear it (§11.4). */
export function effectiveVerdict(
  feedback: DeriveInput['feedback'],
  snapshotId: string,
): Verdict | null {
  let verdict: Verdict | null = null;
  for (const entry of feedback)
    if (entry.snapshot_id === snapshotId && entry.verdict) verdict = entry.verdict;
  return verdict;
}

/** Effective verdict of the latest Snapshot only. */
export function latestVerdict(input: DeriveInput): Verdict | null {
  const latest = input.snapshots.at(-1);
  return latest ? effectiveVerdict(input.feedback, latest.id) : null;
}

/** Current answer state takes precedence over historical verdicts (§12.1, §11.5). */
export function tileState(input: DeriveInput): TileState {
  if (input.answer_state === 'working') return input.has_content ? 'working' : 'empty';
  return latestVerdict(input) ?? 'ready';
}

/** One verdict per reviewed Snapshot, in Snapshot order. */
export function reviewedVerdicts(input: DeriveInput): { snapshot_id: string; verdict: Verdict }[] {
  const out: { snapshot_id: string; verdict: Verdict }[] = [];
  for (const snapshot of input.snapshots) {
    const verdict = effectiveVerdict(input.feedback, snapshot.id);
    if (verdict) out.push({ snapshot_id: snapshot.id, verdict });
  }
  return out;
}

/** Compares the two latest distinct reviewed Snapshots only (§12.2). */
export function trend(input: DeriveInput): Trend | null {
  const reviewed = reviewedVerdicts(input);
  const latest = reviewed.at(-1)?.verdict;
  if (!latest) return null;
  const previous = reviewed.at(-2)?.verdict;
  if (previous && RANK[latest] > RANK[previous]) return 'improved';
  if (previous && RANK[latest] < RANK[previous]) return 'regressed';
  return latest;
}

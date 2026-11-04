import type {
  FeedbackEntry,
  ProblemDetail,
  ProblemSummary,
  SnapshotSummary,
  TileState,
  Trend,
  Verdict,
} from '../../shared/model';

// Pure presentation helpers shared by the board components. Review status itself comes from
// src/shared/derive.ts through the API; nothing here re-derives verdicts or trends.

export const VERDICT: Record<Verdict, [symbol: string, label: string]> = {
  correct: ['✓', 'Correct'],
  partial: ['½', 'Partially correct'],
  incorrect: ['✕', 'Incorrect'],
};

export const hhmm = (time: string | number) => {
  const date = new Date(time);
  return (
    String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0')
  );
};

/** The batch (third level: Collection / Set / Batch) a problem belongs to. */
export const batchOf = (problem: ProblemSummary) => problem.type ?? 'Problems';

/** Problems of one set in their navigation order: batch by batch, each in its own order. */
export function inSet(problems: ProblemSummary[], setId: string) {
  const ordered = problems
    .filter((problem) => problem.set_id === setId)
    .sort((a, b) => a.sort_order - b.sort_order);
  const batches = [...new Set(ordered.map(batchOf))];
  return ordered.sort((a, b) => batches.indexOf(batchOf(a)) - batches.indexOf(batchOf(b)));
}

/** Problems are numbered within their batch. */
export const numberOf = (problems: ProblemSummary[], problem: ProblemSummary) =>
  inSet(problems, problem.set_id)
    .filter((other) => batchOf(other) === batchOf(problem))
    .indexOf(problem) + 1;

export const snapshotOf = (detail: ProblemDetail, id: string): SnapshotSummary | undefined =>
  detail.snapshots.find((snapshot) => snapshot.id === id);

/**
 * The feedback the Review control shows (§7.4): the selected entry, else the latest on the latest
 * Snapshot, else the latest on an earlier Snapshot (labelled historical).
 */
export function shownFeedback(
  detail: ProblemDetail,
  selected: string | null,
): FeedbackEntry | null {
  if (!detail.feedback.length) return null;
  const chosen = selected && detail.feedback.find((entry) => entry.id === selected);
  if (chosen) return chosen;
  const latest = detail.snapshots.at(-1);
  const onLatest = detail.feedback.filter((entry) => entry.snapshot_id === latest?.id);
  return onLatest.at(-1) ?? detail.feedback.at(-1)!;
}

/** CSS class of a verdict colour: an earlier Snapshot's feedback is grey, not a current verdict. */
export function verdictClass(entry: FeedbackEntry, detail: ProblemDetail) {
  if (entry.snapshot_id !== detail.snapshots.at(-1)?.id) return 'v-old';
  return entry.verdict ? 'v-' + entry.verdict : 'v-none';
}

export const TILE_CLASS: Record<TileState, string> = {
  empty: 'empty',
  working: 'progress',
  ready: 'ready',
  correct: 'correct',
  partial: 'partial',
  incorrect: 'incorrect',
};
export const TILE_LABEL: Record<TileState, string> = {
  empty: 'not started',
  working: 'editing',
  ready: 'ready for review',
  correct: 'correct',
  partial: 'partially correct',
  incorrect: 'incorrect',
};

export function trendBadge(trend: Trend | null): { symbol: string; label: string } | null {
  if (!trend) return null;
  if (trend === 'improved') return { symbol: '↗', label: 'better than the last reviewed snapshot' };
  if (trend === 'regressed') return { symbol: '↘', label: 'worse than the last reviewed snapshot' };
  return { symbol: VERDICT[trend][0], label: '' };
}

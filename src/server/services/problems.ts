import { latestVerdict, tileState, trend } from '../../shared/derive';
import { DomainError } from '../../shared/errors';
import type {
  AnswerState,
  CollectionSummary,
  CreateProblemsResult,
  FeedbackEntry,
  ProblemDetail,
  ProblemPage,
  ProblemSummary,
  SnapshotSummary,
  Verdict,
} from '../../shared/model';
import { LIMITS } from '../../shared/limits';
import type { CreateProblemsInput, ListProblemsInput } from '../../shared/schemas';
import type { AppContext } from '../env';
import {
  bumpCounter,
  commit,
  committedSeq,
  isUniqueViolation,
  iso,
  newId,
  notify,
  now,
  record,
  replay,
  sha256,
} from './store';

export interface ProblemRow {
  id: string;
  list_order: number;
  set_id: string;
  set_title: string;
  collection_id: string;
  collection_title: string;
  title: string;
  body: string;
  type: string | null;
  sort_order: number;
  answer_state: AnswerState;
  edit_epoch: number;
  canvas_revision: number;
  canvas_key: string | null;
  canvas_previous_key: string | null;
  canvas_fingerprint: string | null;
  has_content: number;
  latest_snapshot_seq: number;
  created_at: number;
}
const PROBLEM_COLUMNS = `p.id, p.list_order, p.set_id, s.title AS set_title, s.collection_id,
  c.title AS collection_title, p.title, p.body, p.type, p.sort_order, p.answer_state, p.edit_epoch,
  p.canvas_revision, p.canvas_key, p.canvas_previous_key, p.canvas_fingerprint, p.has_content,
  p.latest_snapshot_seq, p.created_at`;
const PROBLEM_FROM = `problems p JOIN problem_sets s ON s.id = p.set_id JOIN collections c ON c.id = s.collection_id`;

export interface SnapshotRow {
  id: string;
  problem_id: string;
  sequence: number;
  image_key: string;
  image_length: number;
  width: number;
  height: number;
  source_revision: number;
  fingerprint: string;
  created_at: number;
}
interface FeedbackRow {
  id: string;
  problem_id: string;
  snapshot_id: string;
  verdict: Verdict | null;
  text: string;
  callouts: string;
  created_at: number;
}

export async function requireProblem(ctx: AppContext, problemId: string): Promise<ProblemRow> {
  const row = await ctx.db
    .prepare(`SELECT ${PROBLEM_COLUMNS} FROM ${PROBLEM_FROM} WHERE p.id = ?`)
    .bind(problemId)
    .first<ProblemRow>();
  if (!row) throw new DomainError('not_found', 'Problem not found');
  return row;
}

export const toSnapshot = (row: SnapshotRow): SnapshotSummary => ({
  id: row.id,
  problem_id: row.problem_id,
  sequence: row.sequence,
  source_revision: row.source_revision,
  fingerprint: row.fingerprint,
  width: row.width,
  height: row.height,
  created_at: iso(row.created_at),
});

const toFeedback = (row: FeedbackRow): FeedbackEntry => ({
  id: row.id,
  problem_id: row.problem_id,
  snapshot_id: row.snapshot_id,
  verdict: row.verdict,
  text: row.text,
  callouts: JSON.parse(row.callouts),
  created_at: iso(row.created_at),
});

function summary(
  row: ProblemRow,
  snapshots: { id: string }[],
  feedback: Pick<FeedbackEntry, 'snapshot_id' | 'verdict'>[],
): ProblemSummary {
  const derive = {
    answer_state: row.answer_state,
    has_content: !!row.has_content,
    snapshots,
    feedback,
  };
  return {
    id: row.id,
    set_id: row.set_id,
    set_title: row.set_title,
    collection_id: row.collection_id,
    collection_title: row.collection_title,
    title: row.title,
    type: row.type,
    sort_order: row.sort_order,
    answer_state: row.answer_state,
    latest_snapshot_id: snapshots.at(-1)?.id ?? null,
    latest_snapshot_seq: row.latest_snapshot_seq,
    latest_verdict: latestVerdict(derive),
    tile: tileState(derive),
    trend: trend(derive),
    created_at: iso(row.created_at),
  };
}

const CREATE = 'create_problems';

export function problemService(ctx: AppContext) {
  return {
    /** Append problems in order to an existing set or an explicitly new one; idempotent on request_id. */
    async create(input: CreateProblemsInput): Promise<CreateProblemsResult> {
      const fingerprint = await sha256(input);
      const previous = await replay<CreateProblemsResult>(
        ctx,
        CREATE,
        input.request_id,
        fingerprint,
      );
      if (previous) return previous;

      const time = now();
      const statements: D1PreparedStatement[] = [];
      let setId: string;
      let collectionId: string;
      let condition;
      if (input.set_id) {
        const set = await ctx.db
          .prepare('SELECT collection_id FROM problem_sets WHERE id = ?')
          .bind(input.set_id)
          .first<{ collection_id: string }>();
        if (!set) throw new DomainError('not_found', 'Problem Set not found');
        setId = input.set_id;
        collectionId = set.collection_id;
        condition = { sql: 'EXISTS (SELECT 1 FROM problem_sets WHERE id = ?)', binds: [setId] };
      } else {
        const newSet = input.new_set!;
        setId = newId('set');
        if (newSet.collection_id) {
          collectionId = newSet.collection_id;
          condition = {
            sql: 'EXISTS (SELECT 1 FROM collections WHERE id = ?)',
            binds: [collectionId],
          };
        } else {
          collectionId = newId('col');
          condition = { sql: '1', binds: [] };
          statements.push(
            ctx.db
              .prepare('INSERT INTO collections (id, title, created_at) VALUES (?, ?, ?)')
              .bind(collectionId, newSet.new_collection_title, time),
          );
        }
        statements.push(
          ctx.db
            .prepare(
              `INSERT INTO problem_sets (id, collection_id, title, sort_order, created_at)
               SELECT ?, ?, ?, COALESCE(MAX(sort_order), 0) + 1, ? FROM problem_sets WHERE collection_id = ?`,
            )
            .bind(setId, collectionId, newSet.title, time, collectionId),
        );
      }
      const result: CreateProblemsResult = {
        problem_ids: input.problems.map(() => newId('prob')),
        set_id: setId,
        collection_id: collectionId,
      };
      input.problems.forEach((problem, index) =>
        statements.push(
          ctx.db
            .prepare(
              `INSERT INTO problems (id, list_order, set_id, title, body, type, sort_order, created_at, updated_at)
               VALUES (?, (SELECT COALESCE(MAX(list_order), 0) + 1 FROM problems), ?, ?, ?, ?,
                 (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM problems WHERE set_id = ?), ?, ?)`,
            )
            .bind(
              result.problem_ids[index],
              setId,
              problem.title,
              problem.body,
              problem.type ?? null,
              setId,
              time,
              time,
            ),
        ),
      );
      statements.push(record(ctx, CREATE, input.request_id, fingerprint, result), bumpCounter(ctx));
      try {
        const committed = await commit(ctx, condition, statements);
        if (!committed.ok) throw new DomainError('not_found', 'The destination no longer exists');
        await notify(ctx, committedSeq(committed.results.at(-1)));
        return result;
      } catch (error) {
        // A concurrent retry with the same request_id won; return its result.
        if (isUniqueViolation(error)) {
          const winner = await replay<CreateProblemsResult>(
            ctx,
            CREATE,
            input.request_id,
            fingerprint,
          );
          if (winner) return winner;
        }
        throw error;
      }
    },

    async list(input: ListProblemsInput): Promise<ProblemPage> {
      const after = input.cursor ? Number(input.cursor) : 0;
      if (!Number.isSafeInteger(after) || after < 0)
        throw new DomainError('invalid_request', 'Invalid cursor');
      const limit = input.limit ?? LIMITS.listPageSize;
      const { results: rows } = await ctx.db
        .prepare(
          `SELECT ${PROBLEM_COLUMNS} FROM ${PROBLEM_FROM}
           WHERE (?1 IS NULL OR s.collection_id = ?1) AND (?2 IS NULL OR p.set_id = ?2)
             AND (?3 IS NULL OR p.answer_state = ?3) AND p.list_order > ?4
           ORDER BY p.list_order LIMIT ?5`,
        )
        .bind(
          input.collection_id ?? null,
          input.set_id ?? null,
          input.answer_state ?? null,
          after,
          limit + 1,
        )
        .all<ProblemRow>();
      const page = rows.slice(0, limit);
      if (!page.length) return { problems: [], next_cursor: null };
      const ids = JSON.stringify(page.map((row) => row.id));
      const [snapshots, feedback] = await ctx.db.batch<{
        id: string;
        problem_id: string;
        snapshot_id: string;
        verdict: Verdict | null;
      }>([
        ctx.db
          .prepare(
            'SELECT id, problem_id FROM snapshots WHERE problem_id IN (SELECT value FROM json_each(?)) ORDER BY sequence',
          )
          .bind(ids),
        ctx.db
          .prepare(
            'SELECT problem_id, snapshot_id, verdict FROM feedback WHERE problem_id IN (SELECT value FROM json_each(?)) AND verdict IS NOT NULL ORDER BY list_order',
          )
          .bind(ids),
      ]);
      return {
        problems: page.map((row) =>
          summary(
            row,
            snapshots.results.filter((snapshot) => snapshot.problem_id === row.id),
            feedback.results.filter((entry) => entry.problem_id === row.id),
          ),
        ),
        next_cursor: rows.length > limit ? String(page.at(-1)!.list_order) : null,
      };
    },

    async get(problemId: string): Promise<ProblemDetail> {
      const [problem, snapshots, feedback] = await ctx.db.batch([
        ctx.db
          .prepare(`SELECT ${PROBLEM_COLUMNS} FROM ${PROBLEM_FROM} WHERE p.id = ?`)
          .bind(problemId),
        ctx.db
          .prepare('SELECT * FROM snapshots WHERE problem_id = ? ORDER BY sequence')
          .bind(problemId),
        ctx.db
          .prepare('SELECT * FROM feedback WHERE problem_id = ? ORDER BY list_order')
          .bind(problemId),
      ]);
      const row = problem.results[0] as ProblemRow | undefined;
      if (!row) throw new DomainError('not_found', 'Problem not found');
      const snapshotList = (snapshots.results as SnapshotRow[]).map(toSnapshot);
      const feedbackList = (feedback.results as FeedbackRow[]).map(toFeedback);
      const latest = snapshotList.at(-1);
      return {
        ...summary(row, snapshotList, feedbackList),
        body: row.body,
        edit_epoch: row.edit_epoch,
        canvas_revision: row.canvas_revision,
        canvas_fingerprint: row.canvas_fingerprint,
        has_content: !!row.has_content,
        has_unsubmitted_changes: latest
          ? row.canvas_fingerprint !== latest.fingerprint
          : !!row.has_content,
        snapshots: snapshotList,
        feedback: feedbackList,
      };
    },

    async collections(): Promise<CollectionSummary[]> {
      const [collections, sets] = await ctx.db.batch<never>([
        ctx.db.prepare('SELECT id, title FROM collections ORDER BY created_at, id'),
        ctx.db.prepare(
          'SELECT id, collection_id, title, sort_order FROM problem_sets ORDER BY sort_order',
        ),
      ]);
      return (collections.results as { id: string; title: string }[]).map((collection) => ({
        ...collection,
        sets: (sets.results as CollectionSummary['sets']).filter(
          (set) => set.collection_id === collection.id,
        ),
      }));
    },
  };
}

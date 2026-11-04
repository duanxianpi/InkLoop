import { DomainError } from '../../shared/errors';
import type { CanvasMeta, SaveCanvasResult } from '../../shared/model';
import type { SaveCanvasParams } from '../../shared/schemas';
import type { AppContext } from '../env';
import { requireProblem, type ProblemRow } from './problems';
import { bumpCounter, commit, committedSeq, notify, now } from './store';

// Canvas persistence (Architecture §7). The Worker never parses the document: it streams the body
// into a new immutable R2 object, then conditionally advances the D1 pointer.

export interface StoredCanvas {
  meta: CanvasMeta;
  body: ReadableStream<Uint8Array> | null;
}

/** The conflict a request prepared against `expected` would hit now, or null. */
export function lockConflict(
  row: ProblemRow,
  expected: { revision: number; edit_epoch: number },
): DomainError | null {
  const current = {
    revision: row.canvas_revision,
    edit_epoch: row.edit_epoch,
    answer_state: row.answer_state,
  };
  if (row.answer_state === 'ready_for_review')
    return new DomainError(
      'canvas_locked',
      'Ready for Review. Resume editing to make changes.',
      current,
    );
  if (row.edit_epoch !== expected.edit_epoch)
    return new DomainError('edit_epoch_changed', 'The canvas was locked and reopened', current);
  if (row.canvas_revision !== expected.revision)
    return new DomainError('revision_conflict', 'The canvas changed on another device', current);
  return null;
}

const meta = (row: ProblemRow): CanvasMeta => ({
  revision: row.canvas_revision,
  edit_epoch: row.edit_epoch,
  answer_state: row.answer_state,
  fingerprint: row.canvas_fingerprint,
});

const random = () => crypto.randomUUID().slice(0, 8);

export function canvasService(ctx: AppContext) {
  return {
    async get(problemId: string): Promise<StoredCanvas> {
      const row = await requireProblem(ctx, problemId);
      if (!row.canvas_key) return { meta: meta(row), body: null };
      const object = await ctx.storage.get(row.canvas_key);
      if (!object) throw new DomainError('upload_failed', 'The stored canvas is unavailable');
      return { meta: meta(row), body: object.body };
    },

    /** Optimistic save against base_revision and edit_epoch; rejected while Ready for Review (§17.2, §17.3). */
    async save(
      problemId: string,
      params: SaveCanvasParams,
      body: ReadableStream<Uint8Array>,
    ): Promise<SaveCanvasResult> {
      const expected = { revision: params.base_revision, edit_epoch: params.edit_epoch };
      const row = await requireProblem(ctx, problemId).catch(async (error) => {
        await body.cancel();
        throw error;
      });
      const conflict = lockConflict(row, expected);
      if (conflict) {
        await body.cancel();
        throw conflict;
      }
      const revision = row.canvas_revision + 1;
      const key = `canvas/${problemId}/${revision}-${random()}.json`;
      await ctx.storage.put(key, body, { httpMetadata: { contentType: 'application/json' } });

      const time = now();
      const statements = [
        ctx.db
          .prepare(
            `UPDATE problems SET canvas_revision = canvas_revision + 1, canvas_previous_key = canvas_key,
               canvas_key = ?, canvas_fingerprint = ?, has_content = ?, updated_at = ? WHERE id = ?`,
          )
          .bind(key, params.fingerprint, params.has_content ? 1 : 0, time, problemId),
      ];
      // Overview tiles show empty/working, so only a change of has_content is a visible change.
      const visible = !!row.has_content !== params.has_content;
      if (visible) statements.push(bumpCounter(ctx));
      const committed = await commit(
        ctx,
        {
          sql: `EXISTS (SELECT 1 FROM problems WHERE id = ? AND answer_state = 'working' AND edit_epoch = ? AND canvas_revision = ?)`,
          binds: [problemId, expected.edit_epoch, expected.revision],
        },
        statements,
      );
      if (!committed.ok) {
        // A definite rollback: the new object is unreferenced.
        await ctx.storage.delete(key).catch(() => undefined);
        throw (
          lockConflict(await requireProblem(ctx, problemId), expected) ??
          new DomainError('revision_conflict', 'The canvas changed on another device')
        );
      }
      // Keep the current and the previous revision; the one before is no longer referenced.
      if (row.canvas_previous_key)
        await ctx.storage.delete(row.canvas_previous_key).catch(() => undefined);
      if (visible) await notify(ctx, committedSeq(committed.results.at(-1)));
      return { problem_id: problemId, revision, has_content: params.has_content };
    },
  };
}

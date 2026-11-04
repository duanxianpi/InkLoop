import { DomainError } from '../../shared/errors';
import type { DeleteProblemsInput, UpdateProblemInput } from '../../shared/schemas';
import type { AppContext } from '../env';
import { requireProblem } from './problems';
import { bumpCounter, commit, committedSeq, notify, now } from './store';

// Editing and removing problems, sets and collections. Feedback stays append-only and Snapshots
// immutable; deleting a Problem is the one way they go, together with it (migration 0006).

export function organizeService(ctx: AppContext) {
  /** Commit `statements` with a visible change, then notify open pages. */
  async function write(condition: Parameters<typeof commit>[1], statements: D1PreparedStatement[]) {
    const committed = await commit(ctx, condition, [...statements, bumpCounter(ctx)]);
    if (committed.ok) await notify(ctx, committedSeq(committed.results.at(-1)));
    return committed;
  }

  return {
    async updateProblem(input: UpdateProblemInput) {
      await requireProblem(ctx, input.problem_id);
      const { ok } = await write(
        { sql: 'EXISTS (SELECT 1 FROM problems WHERE id = ?)', binds: [input.problem_id] },
        [
          ctx.db
            .prepare(
              `UPDATE problems SET title = COALESCE(?, title), body = COALESCE(?, body),
                 type = CASE WHEN ? THEN ? ELSE type END, updated_at = ? WHERE id = ?`,
            )
            .bind(
              input.title ?? null,
              input.body ?? null,
              input.type !== undefined ? 1 : 0,
              input.type ?? null,
              now(),
              input.problem_id,
            ),
        ],
      );
      if (!ok) throw new DomainError('not_found', 'Problem not found');
      const row = await requireProblem(ctx, input.problem_id);
      return { problem_id: row.id, title: row.title, body: row.body, type: row.type };
    },

    /** Delete problems with their canvas, Snapshots and feedback. Unknown IDs are reported. */
    async deleteProblems(input: DeleteProblemsInput) {
      const ids = [...new Set(input.problem_ids)];
      const json = JSON.stringify(ids);
      const inIds = 'IN (SELECT value FROM json_each(?))';
      // The object keys come from the deleting statements themselves, so a canvas save that
      // commits just before the deletion is cleaned up too; one that commits after it fails its
      // guard and removes its own upload (canvas.ts).
      const committed = await write(
        { sql: `EXISTS (SELECT 1 FROM problems WHERE id ${inIds})`, binds: [json] },
        [
          ctx.db.prepare(`INSERT INTO problem_deletions SELECT value FROM json_each(?)`).bind(json),
          ctx.db.prepare(`DELETE FROM feedback WHERE problem_id ${inIds}`).bind(json),
          ctx.db
            .prepare(`DELETE FROM snapshots WHERE problem_id ${inIds} RETURNING image_key`)
            .bind(json),
          ctx.db
            .prepare(
              `DELETE FROM problems WHERE id ${inIds} RETURNING id, canvas_key, canvas_previous_key`,
            )
            .bind(json),
          ctx.db.prepare(`DELETE FROM problem_deletions WHERE problem_id ${inIds}`).bind(json),
        ],
      );
      if (!committed.ok) return { deleted: [], not_found: ids };
      const snapshots = committed.results[2].results as { image_key: string }[];
      const problems = committed.results[3].results as {
        id: string;
        canvas_key: string | null;
        canvas_previous_key: string | null;
      }[];
      // The rows are gone; the objects they pointed at are now unreferenced.
      const keys = [
        ...problems.flatMap((row) => [row.canvas_key, row.canvas_previous_key]),
        ...snapshots.map((row) => row.image_key),
      ].filter((key): key is string => !!key);
      if (keys.length) await ctx.storage.delete(keys).catch(() => undefined);
      const found = problems.map((row) => row.id);
      return { deleted: found, not_found: ids.filter((value) => !found.includes(value)) };
    },

    async renameSet(setId: string, title: string) {
      const { ok } = await write(
        { sql: 'EXISTS (SELECT 1 FROM problem_sets WHERE id = ?)', binds: [setId] },
        [ctx.db.prepare('UPDATE problem_sets SET title = ? WHERE id = ?').bind(title, setId)],
      );
      if (!ok) throw new DomainError('not_found', 'Problem Set not found');
      return { set_id: setId, title };
    },

    async renameCollection(collectionId: string, title: string) {
      const { ok } = await write(
        { sql: 'EXISTS (SELECT 1 FROM collections WHERE id = ?)', binds: [collectionId] },
        [ctx.db.prepare('UPDATE collections SET title = ? WHERE id = ?').bind(title, collectionId)],
      );
      if (!ok) throw new DomainError('not_found', 'Collection not found');
      return { collection_id: collectionId, title };
    },

    /** Only an empty set: delete its problems first, so nothing written is removed by accident. */
    async deleteSet(setId: string) {
      const set = await ctx.db
        .prepare('SELECT id FROM problem_sets WHERE id = ?')
        .bind(setId)
        .first();
      if (!set) throw new DomainError('not_found', 'Problem Set not found');
      const { ok } = await write(
        { sql: 'NOT EXISTS (SELECT 1 FROM problems WHERE set_id = ?)', binds: [setId] },
        [ctx.db.prepare('DELETE FROM problem_sets WHERE id = ?').bind(setId)],
      );
      if (!ok)
        throw new DomainError(
          'invalid_request',
          'The Problem Set still has problems; delete them with delete_problems first',
        );
      return { deleted: setId };
    },

    /** Only a collection without problems; its (empty) sets go with it. */
    async deleteCollection(collectionId: string) {
      const collection = await ctx.db
        .prepare('SELECT id FROM collections WHERE id = ?')
        .bind(collectionId)
        .first();
      if (!collection) throw new DomainError('not_found', 'Collection not found');
      const { ok } = await write(
        {
          sql: 'NOT EXISTS (SELECT 1 FROM problems p JOIN problem_sets s ON s.id = p.set_id WHERE s.collection_id = ?)',
          binds: [collectionId],
        },
        [
          ctx.db.prepare('DELETE FROM problem_sets WHERE collection_id = ?').bind(collectionId),
          ctx.db.prepare('DELETE FROM collections WHERE id = ?').bind(collectionId),
        ],
      );
      if (!ok)
        throw new DomainError(
          'invalid_request',
          'The Collection still has problems; delete them with delete_problems first',
        );
      return { deleted: collectionId };
    },
  };
}

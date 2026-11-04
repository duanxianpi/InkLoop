import { DomainError } from '../../shared/errors';
import type { AppendFeedbackResult } from '../../shared/model';
import type { AppendFeedbackInput } from '../../shared/schemas';
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

const APPEND = 'append_feedback';

export function feedbackService(ctx: AppContext) {
  return {
    /** Append-only, bound to the explicit Snapshot (§11). Retries dedupe only with idempotency_key. */
    async append(input: AppendFeedbackInput): Promise<AppendFeedbackResult> {
      const key = input.idempotency_key;
      const fingerprint = await sha256({ ...input, idempotency_key: undefined });
      if (key) {
        const previous = await replay<AppendFeedbackResult>(ctx, APPEND, key, fingerprint);
        if (previous) return previous;
      }
      const owned = {
        sql: 'EXISTS (SELECT 1 FROM snapshots WHERE id = ? AND problem_id = ?)',
        binds: [input.snapshot_id, input.problem_id],
      };
      const time = now();
      const result: AppendFeedbackResult = {
        feedback_id: newId('fb'),
        problem_id: input.problem_id,
        snapshot_id: input.snapshot_id,
        created_at: iso(time),
      };
      const statements = [
        ctx.db
          .prepare(
            `INSERT INTO feedback (id, list_order, problem_id, snapshot_id, verdict, text, callouts, created_at)
             VALUES (?, (SELECT COALESCE(MAX(list_order), 0) + 1 FROM feedback), ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            result.feedback_id,
            input.problem_id,
            input.snapshot_id,
            input.verdict ?? null,
            input.feedback,
            JSON.stringify(input.callouts ?? []),
            time,
          ),
      ];
      if (key) statements.push(record(ctx, APPEND, key, fingerprint, result));
      statements.push(bumpCounter(ctx));
      try {
        const committed = await commit(ctx, owned, statements);
        if (!committed.ok)
          throw new DomainError('not_found', 'Snapshot not found for this problem');
        await notify(ctx, committedSeq(committed.results.at(-1)));
        return result;
      } catch (error) {
        if (key && isUniqueViolation(error)) {
          const winner = await replay<AppendFeedbackResult>(ctx, APPEND, key, fingerprint);
          if (winner) return winner;
        }
        throw error;
      }
    },
  };
}

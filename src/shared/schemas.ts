import { z } from 'zod';
import { LIMITS } from './limits';

// Input contracts shared by MCP tools and the Browser API so both transports validate identically.

export const id = z.string().min(1).max(LIMITS.idLength);
export const idempotencyKey = z.string().min(1).max(LIMITS.idempotencyKeyLength);
export const verdict = z.enum(['correct', 'partial', 'incorrect']);
export const answerState = z.enum(['working', 'ready_for_review']);

export const problemInput = z.object({
  title: z.string().min(1).max(LIMITS.titleLength),
  body: z
    .string()
    .min(1)
    .max(LIMITS.bodyLength)
    .describe('Problem statement; Markdown with $…$ / $$…$$ math. Raw HTML is not rendered.'),
  type: z.string().min(1).max(LIMITS.typeLength).optional().describe('Optional category'),
});

export const createProblemsInput = z
  .object({
    request_id: idempotencyKey.describe(
      'Stable identifier for this request; retries with the same value return the original problem IDs.',
    ),
    set_id: id
      .optional()
      .describe('Existing Problem Set to append to. Provide exactly one of set_id or new_set.'),
    new_set: z
      .object({
        title: z.string().min(1).max(LIMITS.titleLength),
        collection_id: id.optional().describe('Existing Collection for the new set.'),
        new_collection_title: z
          .string()
          .min(1)
          .max(LIMITS.titleLength)
          .optional()
          .describe('Create a new Collection with this title instead.'),
      })
      .refine(
        (value) =>
          (value.collection_id !== undefined) !== (value.new_collection_title !== undefined),
        {
          message: 'Provide exactly one of collection_id or new_collection_title',
        },
      )
      .optional()
      .describe(
        'Explicitly create a new Problem Set with exactly one of collection_id or new_collection_title. Titles are never matched against existing sets.',
      ),
    problems: z.array(problemInput).min(1).max(LIMITS.createProblemsBatch),
  })
  .refine((value) => (value.set_id !== undefined) !== (value.new_set !== undefined), {
    message: 'Provide exactly one of set_id or new_set',
  });
export type CreateProblemsInput = z.infer<typeof createProblemsInput>;

export const listProblemsInput = z.object({
  collection_id: id.optional(),
  set_id: id.optional(),
  answer_state: answerState.optional(),
  cursor: z.string().max(20).optional(),
  limit: z.number().int().min(1).max(LIMITS.listPageSize).optional(),
});
export type ListProblemsInput = z.infer<typeof listProblemsInput>;

export const getSubmissionInput = z.object({ problem_id: id });

export const callout = z.object({
  label: z.string().min(1).max(200),
  text: z.string().min(1).max(LIMITS.calloutLength),
});
export const appendFeedbackInput = z.object({
  problem_id: id,
  snapshot_id: id.describe('The exact Snapshot that was reviewed, as returned by get_submission.'),
  feedback: z
    .string()
    .min(1)
    .max(LIMITS.feedbackLength)
    .describe('Markdown with $…$ / $$…$$ math. Raw HTML is not rendered.'),
  verdict: verdict.optional(),
  callouts: z.array(callout).max(LIMITS.callouts).optional(),
  idempotency_key: idempotencyKey.optional(),
});
export type AppendFeedbackInput = z.infer<typeof appendFeedbackInput>;

export const canvasDocument = z.object({
  store: z.record(z.string(), z.looseObject({ id: z.string(), typeName: z.string() })),
  schema: z.unknown(),
});

export const saveCanvasInput = z.object({
  base_revision: z.number().int().min(0),
  edit_epoch: z.number().int().min(0),
  document: canvasDocument,
});
export type SaveCanvasInput = z.infer<typeof saveCanvasInput>;

export const commitParams = z.object({
  revision: z.coerce.number().int().min(0),
  edit_epoch: z.coerce.number().int().min(0),
});

export const preferencesInput = z.record(z.string().max(100), z.unknown());

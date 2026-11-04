import { z } from 'zod';
import { LIMITS } from './limits';

// Input contracts shared by MCP tools and the Browser API so both transports validate identically.

export const id = z.string().min(1).max(LIMITS.idLength);
export const idempotencyKey = z.string().min(1).max(LIMITS.idempotencyKeyLength);
export const verdict = z.enum(['correct', 'partial', 'incorrect']);
export const answerState = z.enum(['working', 'ready_for_review']);

// The board organises problems in three levels: Collection (a course) / Problem Set (a week or
// unit) / batch (`type`: a kind of exercise within the set). The title is the problem's topic.
const batch = z
  .string()
  .min(1)
  .max(LIMITS.typeLength)
  .describe(
    "Batch: the third level, grouping a set's problems by kind of exercise, e.g. 'Practice', 'Prediction', 'Translation'. Problems are numbered within their batch (Q1, Q2…). Never the topic: that is the title.",
  );

export const problemInput = z.object({
  title: z
    .string()
    .min(1)
    .max(LIMITS.titleLength)
    .describe(
      "The problem's topic, e.g. 'Scaled dot-product attention'. No numbering, set or batch name: the board shows those.",
    ),
  body: z
    .string()
    .min(1)
    .max(LIMITS.bodyLength)
    .describe('Problem statement; Markdown with $…$ / $$…$$ math. Raw HTML is not rendered.'),
  type: batch.optional(),
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
        title: z
          .string()
          .min(1)
          .max(LIMITS.titleLength)
          .describe(
            "Second level, e.g. 'Week 8'. One set per week or unit: put different kinds of exercise in batches (type) of the same set, not in sets such as 'Week 8 · Practice'.",
          ),
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

export const getSubmissionInput = z.object({
  problem_id: id,
  snapshot_id: id
    .optional()
    .describe(
      'An earlier Snapshot of this problem to retrieve instead of the latest, e.g. to compare attempts. Omit for the latest committed Snapshot.',
    ),
});
export type GetSubmissionInput = z.infer<typeof getSubmissionInput>;

export const getProblemInput = z.object({ problem_id: id });

export const listCollectionsInput = z.object({});

export const updateProblemInput = z
  .object({
    problem_id: id,
    title: z.string().min(1).max(LIMITS.titleLength).optional(),
    body: z
      .string()
      .min(1)
      .max(LIMITS.bodyLength)
      .optional()
      .describe('New problem statement; Markdown with $…$ / $$…$$ math.'),
    type: batch.nullable().optional().describe('New batch, or null to remove it.'),
  })
  .refine(
    (value) => value.title !== undefined || value.body !== undefined || value.type !== undefined,
    { message: 'Provide at least one of title, body or type' },
  );
export type UpdateProblemInput = z.infer<typeof updateProblemInput>;

export const deleteProblemsInput = z.object({
  problem_ids: z.array(id).min(1).max(LIMITS.createProblemsBatch),
});
export type DeleteProblemsInput = z.infer<typeof deleteProblemsInput>;

export const moveProblemsInput = z.object({
  problem_ids: z
    .array(id)
    .min(1)
    .max(LIMITS.createProblemsBatch)
    .describe('Problems to move, in the order they should take at the end of the set.'),
  set_id: id.describe('Destination Problem Set; the current set reorders them to its end.'),
  type: batch
    .nullable()
    .optional()
    .describe("Batch to put them in; null removes it; omit to keep each problem's batch."),
});
export type MoveProblemsInput = z.infer<typeof moveProblemsInput>;

export const updateProblemSetInput = z.object({
  set_id: id,
  title: z.string().min(1).max(LIMITS.titleLength),
});
export const updateCollectionInput = z.object({
  collection_id: id,
  title: z.string().min(1).max(LIMITS.titleLength),
});
export const deleteProblemSetInput = z.object({ set_id: id });
export const deleteCollectionInput = z.object({ collection_id: id });

export const calloutKind = z.enum(['correct', 'fix', 'incorrect']);
export const callout = z.object({
  kind: calloutKind.describe(
    'correct: a step that is right; fix: a step that is incomplete or needs a change; incorrect: a wrong step.',
  ),
  math: z
    .string()
    .min(1)
    .max(LIMITS.calloutLength)
    .optional()
    .describe('The step being discussed, quoted as display LaTeX without $ delimiters.'),
  text: z
    .string()
    .min(1)
    .max(LIMITS.calloutLength)
    .describe('Explanation; Markdown with $…$ math. Raw HTML is not rendered.'),
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

// Canvas saves carry the document as the body; these query parameters are all the Worker reads.
export const saveCanvasParams = z.object({
  base_revision: z.coerce.number().int().min(0),
  edit_epoch: z.coerce.number().int().min(0),
  fingerprint: z.string().min(1).max(LIMITS.fingerprintLength),
  has_content: z.enum(['0', '1']).transform((value) => value === '1'),
});
export type SaveCanvasParams = z.infer<typeof saveCanvasParams>;

export const commitParams = z.object({
  revision: z.coerce.number().int().min(0),
  edit_epoch: z.coerce.number().int().min(0),
});

export const preferencesInput = z.record(z.string().max(100), z.unknown());

import type {
  AppendFeedbackInput,
  CreateProblemsInput,
  DeleteProblemsInput,
  GetSubmissionInput,
  ListProblemsInput,
  UpdateProblemInput,
} from '../../shared/schemas';
import { LIMITS } from '../../shared/limits';
import { HttpError } from '../http/errors';

// Plain MCP input validators. Each one mirrors a zod schema in src/shared/schemas.ts, which stays
// the authoritative contract: it generates the published tools/list JSON Schema at build time, and
// tests/contracts.test.mjs checks that these functions accept and reject the same inputs.
// zod is kept off this path because workerd forbids `new Function`, so zod runs its slow
// interpreter there and copies every object it validates.
//
// Like zod's default z.object, validators drop unknown keys rather than reject them. Failures throw
// HttpError(400), which the tool runner returns as an `isError` result the model can correct.

type Fields = Record<string, unknown>;

function fail(path: string, message: string): never {
  throw new HttpError(400, `${path}: ${message}`);
}

function object(value: unknown, path: string): Fields {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    fail(path, 'expected an object');
  return value as Fields;
}

// String bounds count UTF-16 code units, matching zod's .min()/.max().
function string(value: unknown, path: string, min: number, max: number): string {
  if (typeof value !== 'string') fail(path, 'expected a string');
  if (value.length < min || value.length > max) fail(path, `expected ${min} to ${max} characters`);
  return value;
}

/** Absent (undefined) passes as undefined; null is rejected, as with zod's .optional(). */
function optional<T>(value: unknown, check: (value: unknown) => T): T | undefined {
  return value === undefined ? undefined : check(value);
}

function array(value: unknown, path: string, min: number, max: number): unknown[] {
  if (!Array.isArray(value)) fail(path, 'expected an array');
  if (value.length < min || value.length > max) fail(path, `expected ${min} to ${max} items`);
  return value;
}

function oneOf<T extends string>(value: unknown, path: string, options: readonly T[]): T {
  if (!options.includes(value as T)) fail(path, `expected one of ${options.join(', ')}`);
  return value as T;
}

const id = (path: string) => (value: unknown) => string(value, path, 1, LIMITS.idLength);
const idempotencyKey = (path: string) => (value: unknown) =>
  string(value, path, 1, LIMITS.idempotencyKeyLength);

export function parseCreateProblems(raw: unknown): CreateProblemsInput {
  const input = object(raw, 'arguments');
  const request_id = idempotencyKey('request_id')(input.request_id);
  const set_id = optional(input.set_id, id('set_id'));
  const new_set = optional(input.new_set, (value) => {
    const set = object(value, 'new_set');
    const parsed = {
      title: string(set.title, 'new_set.title', 1, LIMITS.titleLength),
      collection_id: optional(set.collection_id, id('new_set.collection_id')),
      new_collection_title: optional(set.new_collection_title, (title) =>
        string(title, 'new_set.new_collection_title', 1, LIMITS.titleLength),
      ),
    };
    if ((parsed.collection_id === undefined) === (parsed.new_collection_title === undefined))
      fail('new_set', 'provide exactly one of collection_id or new_collection_title');
    return parsed;
  });
  const problems = array(input.problems, 'problems', 1, LIMITS.createProblemsBatch).map(
    (value, index) => {
      const path = `problems.${index}`;
      const problem = object(value, path);
      return {
        title: string(problem.title, path + '.title', 1, LIMITS.titleLength),
        body: string(problem.body, path + '.body', 1, LIMITS.bodyLength),
        type: optional(problem.type, (type) => string(type, path + '.type', 1, LIMITS.typeLength)),
      };
    },
  );
  if ((set_id === undefined) === (new_set === undefined))
    fail('arguments', 'provide exactly one of set_id or new_set');
  return { request_id, set_id, new_set, problems };
}

export function parseListProblems(raw: unknown): ListProblemsInput {
  const input = object(raw, 'arguments');
  return {
    collection_id: optional(input.collection_id, id('collection_id')),
    set_id: optional(input.set_id, id('set_id')),
    answer_state: optional(input.answer_state, (value) =>
      oneOf(value, 'answer_state', ['working', 'ready_for_review'] as const),
    ),
    cursor: optional(input.cursor, (value) => string(value, 'cursor', 0, 20)),
    limit: optional(input.limit, (value) => {
      // zod's .int() also requires a safe integer.
      if (!Number.isSafeInteger(value)) fail('limit', 'expected an integer');
      if ((value as number) < 1 || (value as number) > LIMITS.listPageSize)
        fail('limit', `expected 1 to ${LIMITS.listPageSize}`);
      return value as number;
    }),
  };
}

export function parseGetSubmission(raw: unknown): GetSubmissionInput {
  const input = object(raw, 'arguments');
  return {
    problem_id: id('problem_id')(input.problem_id),
    snapshot_id: optional(input.snapshot_id, id('snapshot_id')),
  };
}

export function parseGetProblem(raw: unknown): { problem_id: string } {
  const input = object(raw, 'arguments');
  return { problem_id: id('problem_id')(input.problem_id) };
}

export function parseListCollections(raw: unknown): Record<string, never> {
  object(raw, 'arguments');
  return {};
}

export function parseUpdateProblem(raw: unknown): UpdateProblemInput {
  const input = object(raw, 'arguments');
  const parsed = {
    problem_id: id('problem_id')(input.problem_id),
    title: optional(input.title, (value) => string(value, 'title', 1, LIMITS.titleLength)),
    body: optional(input.body, (value) => string(value, 'body', 1, LIMITS.bodyLength)),
    // null removes the category, as with zod's .nullable().optional().
    type:
      input.type === null
        ? null
        : optional(input.type, (value) => string(value, 'type', 1, LIMITS.typeLength)),
  };
  if (parsed.title === undefined && parsed.body === undefined && parsed.type === undefined)
    fail('arguments', 'provide at least one of title, body or type');
  return parsed;
}

export function parseDeleteProblems(raw: unknown): DeleteProblemsInput {
  const input = object(raw, 'arguments');
  return {
    problem_ids: array(input.problem_ids, 'problem_ids', 1, LIMITS.createProblemsBatch).map(
      (value, index) => id(`problem_ids.${index}`)(value),
    ),
  };
}

export function parseUpdateProblemSet(raw: unknown): { set_id: string; title: string } {
  const input = object(raw, 'arguments');
  return {
    set_id: id('set_id')(input.set_id),
    title: string(input.title, 'title', 1, LIMITS.titleLength),
  };
}

export function parseUpdateCollection(raw: unknown): { collection_id: string; title: string } {
  const input = object(raw, 'arguments');
  return {
    collection_id: id('collection_id')(input.collection_id),
    title: string(input.title, 'title', 1, LIMITS.titleLength),
  };
}

export function parseDeleteProblemSet(raw: unknown): { set_id: string } {
  const input = object(raw, 'arguments');
  return { set_id: id('set_id')(input.set_id) };
}

export function parseDeleteCollection(raw: unknown): { collection_id: string } {
  const input = object(raw, 'arguments');
  return { collection_id: id('collection_id')(input.collection_id) };
}

export function parseAppendFeedback(raw: unknown): AppendFeedbackInput {
  const input = object(raw, 'arguments');
  return {
    problem_id: id('problem_id')(input.problem_id),
    snapshot_id: id('snapshot_id')(input.snapshot_id),
    feedback: string(input.feedback, 'feedback', 1, LIMITS.feedbackLength),
    verdict: optional(input.verdict, (value) =>
      oneOf(value, 'verdict', ['correct', 'partial', 'incorrect'] as const),
    ),
    callouts: optional(input.callouts, (value) =>
      array(value, 'callouts', 0, LIMITS.callouts).map((item, index) => {
        const path = `callouts.${index}`;
        const callout = object(item, path);
        return {
          kind: oneOf(callout.kind, path + '.kind', ['correct', 'fix', 'incorrect'] as const),
          math: optional(callout.math, (math) =>
            string(math, path + '.math', 1, LIMITS.calloutLength),
          ),
          text: string(callout.text, path + '.text', 1, LIMITS.calloutLength),
        };
      }),
    ),
    idempotency_key: optional(input.idempotency_key, idempotencyKey('idempotency_key')),
  };
}

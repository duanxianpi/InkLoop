import { DomainError } from '../../shared/errors';
import type {
  AppendFeedbackResult,
  CanvasState,
  ChangeResult,
  CollectionSummary,
  CommitResult,
  CreateProblemsResult,
  NotReady,
  Preferences,
  ProblemDetail,
  ProblemPage,
  ResumeResult,
  SaveCanvasResult,
  Submission,
} from '../../shared/model';
import type {
  AppendFeedbackInput,
  CreateProblemsInput,
  ListProblemsInput,
  SaveCanvasInput,
} from '../../shared/schemas';
import type { AppContext } from '../env';

/**
 * Application services (Specification §14.1). The Browser API and the MCP tools are thin adapters over
 * this interface and contain no business logic of their own.
 * Implementations must enforce authEpoch and content preconditions inside D1 writes, persist
 * scoped idempotency results with the mutation, and isolate post-commit notification failures.
 */
export interface Services {
  problems: {
    /** Append problems in order to an existing set or an explicitly new one; idempotent on request_id. */
    create(input: CreateProblemsInput): Promise<CreateProblemsResult>;
    list(input: ListProblemsInput): Promise<ProblemPage>;
    get(problemId: string): Promise<ProblemDetail>;
    collections(): Promise<CollectionSummary[]>;
  };
  canvas: {
    get(problemId: string): Promise<CanvasState>;
    /** Optimistic save against base_revision and edit_epoch; rejected while Ready for Review (§17.2, §17.3). */
    save(problemId: string, input: SaveCanvasInput): Promise<SaveCanvasResult>;
  };
  submissions: {
    /** Mark ready (§17.1): commit a new Snapshot from the PNG, or reuse an identical latest one. */
    commit(
      problemId: string,
      expected: { revision: number; edit_epoch: number },
      idempotencyKey: string,
      image: ArrayBuffer | null,
    ): Promise<CommitResult>;
    /** Resume editing (§9.1); advances the epoch only on Ready → Working. Repeated resumes return it unchanged. */
    resume(problemId: string): Promise<ResumeResult>;
    /** Latest committed Snapshot only (§10.3, §16.3). */
    latest(problemId: string): Promise<Submission | NotReady>;
    image(snapshotId: string): Promise<ReadableStream>;
  };
  feedback: {
    /** Append-only, bound to the explicit Snapshot (§11). */
    append(input: AppendFeedbackInput): Promise<AppendFeedbackResult>;
  };
  preferences: {
    get(): Promise<Preferences>;
    /** Merge keys; a null value removes the key. */
    update(values: Preferences): Promise<Preferences>;
  };
  changes: {
    /** Without `since`, return the current counter at once; otherwise wait (bounded) until it differs. */
    wait(since: number | null, timeoutMs: number, signal?: AbortSignal): Promise<ChangeResult>;
  };
}

const notImplemented = (name: string) => async (): Promise<never> => {
  throw new DomainError('not_implemented', name);
};

export function createServices(_ctx: AppContext): Services {
  return {
    problems: {
      create: notImplemented('problems.create'),
      list: notImplemented('problems.list'),
      get: notImplemented('problems.get'),
      collections: notImplemented('problems.collections'),
    },
    canvas: { get: notImplemented('canvas.get'), save: notImplemented('canvas.save') },
    submissions: {
      commit: notImplemented('submissions.commit'),
      resume: notImplemented('submissions.resume'),
      latest: notImplemented('submissions.latest'),
      image: notImplemented('submissions.image'),
    },
    feedback: { append: notImplemented('feedback.append') },
    preferences: {
      get: notImplemented('preferences.get'),
      update: notImplemented('preferences.update'),
    },
    changes: { wait: notImplemented('changes.wait') },
  };
}

import type { AppContext } from '../env';
import { canvasService } from './canvas';
import { changeService } from './changes';
import { feedbackService } from './feedback';
import { preferenceService } from './preferences';
import { problemService } from './problems';
import { submissionService } from './submissions';

export type { StoredCanvas } from './canvas';
export type { ImageText } from './submissions';

/**
 * Application services (Specification §14.1). The Browser API and the MCP tools are thin adapters
 * over these and contain no business logic of their own. Every write checks the auth epoch and its
 * content precondition inside one D1 transaction, persists scoped idempotency results with the
 * mutation, and isolates post-commit notification failures.
 */
export function createServices(ctx: AppContext) {
  return {
    problems: problemService(ctx),
    canvas: canvasService(ctx),
    submissions: submissionService(ctx),
    feedback: feedbackService(ctx),
    preferences: preferenceService(ctx),
    changes: changeService(ctx),
  };
}

export type Services = ReturnType<typeof createServices>;

import type { McpServer } from '@modelcontextprotocol/server';
import { DomainError } from '../../shared/errors';
import {
  appendFeedbackInput,
  createProblemsInput,
  getSubmissionInput,
  listProblemsInput,
} from '../../shared/schemas';
import { errorPayload, HttpError } from '../http/errors';
import type { McpIdentity } from '../auth/types';
import type { Services } from '../services';

// The four MCP tools (§16). Each one validates input, enforces scope, and delegates to the same
// application services as the Browser API. No business logic lives here. No append_follow_up (§16.5).

const text = (data: unknown) => ({ type: 'text' as const, text: JSON.stringify(data) });
const ok = (data: Record<string, unknown>) => ({ content: [text(data)], structuredContent: data });

async function run(
  action: () => Promise<{ content: any[]; structuredContent?: Record<string, unknown> }>,
) {
  try {
    return await action();
  } catch (error) {
    const failure = errorPayload(error);
    if (!(error instanceof DomainError || error instanceof HttpError))
      console.error('mcp_tool_error', (error as Error)?.name);
    return { isError: true, content: [text(failure)], structuredContent: failure };
  }
}

export function registerWhiteboardTools(
  server: Pick<McpServer, 'registerTool'>,
  services: Services,
  owner: McpIdentity,
) {
  server.registerTool(
    'create_problems',
    {
      description:
        'Create one or more problems in an existing Problem Set (set_id) or an explicitly new one (new_set). Problems keep the given order, never overwrite existing ones, and do not change the problem the user is viewing. Retrying with the same request_id returns the original IDs.',
      inputSchema: createProblemsInput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) =>
      run(async () => {
        owner.requireScope('mcp:write');
        return ok({ ...(await services.problems.create(input)) });
      }),
  );

  server.registerTool(
    'list_problems',
    {
      description:
        'List problems with Collection/Set metadata, answer state, latest committed Snapshot ID, its review status and trend. Does not include images. Paginate with next_cursor.',
      inputSchema: listProblemsInput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (input) => run(async () => ok({ ...(await services.problems.list(input)) })),
  );

  server.registerTool(
    'get_submission',
    {
      description:
        'Return the latest committed handwritten Snapshot of a problem as an image, with the question and Snapshot metadata. Never returns an unfinished draft; when answer_state is "working", has_unsubmitted_changes tells whether the user has edited since this Snapshot. Returns status "not_ready" when nothing has been submitted.',
      inputSchema: getSubmissionInput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ problem_id }) =>
      run(async () => {
        const submission = await services.submissions.latest(problem_id);
        if (submission.status === 'not_ready') return ok({ ...submission });
        const { image, ...metadata } = submission;
        return {
          content: [
            text(metadata),
            { type: 'image' as const, mimeType: image.mimeType, data: image.data },
          ],
          structuredContent: metadata,
        };
      }),
  );

  server.registerTool(
    'append_feedback',
    {
      description:
        'Append feedback to the exact Snapshot you reviewed (snapshot_id from get_submission). Never overwrites earlier feedback; feedback for older Snapshots is kept as history. verdict is optional. Supply idempotency_key to make retries safe.',
      inputSchema: appendFeedbackInput,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    (input) =>
      run(async () => {
        owner.requireScope('mcp:write');
        return ok({ ...(await services.feedback.append(input)) });
      }),
  );
}

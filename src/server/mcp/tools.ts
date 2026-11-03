import type { ZodType } from 'zod';
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
import {
  parseAppendFeedback,
  parseCreateProblems,
  parseGetSubmission,
  parseListProblems,
} from './input';

// The four MCP tools (§16). Each one validates input, enforces scope, and delegates to the same
// application services as the Browser API. No business logic lives here. No append_follow_up (§16.5).

type Content = { type: 'text'; text: string } | { type: 'image'; mimeType: string; data: string };
export interface ToolResult {
  content: Content[];
  structuredContent?: Record<string, unknown>;
  isError?: true;
}

interface Tool<Input> {
  description: string;
  annotations: Record<string, boolean>;
  /** Build time only: src/tooling/mcp-tools.mjs turns it into the published inputSchema. */
  schema: ZodType;
  /** Request time: plain validator mirroring `schema` (see ./input.ts). */
  parse(raw: unknown): Input;
  /** Mutation tools additionally require the mcp:write scope. */
  write: boolean;
  call(input: Input, services: Services): Promise<ToolResult>;
}

const text = (data: unknown): Content => ({ type: 'text', text: JSON.stringify(data) });
const ok = (data: Record<string, unknown>): ToolResult => ({
  content: [text(data)],
  structuredContent: data,
});

// `satisfies` keeps each tool's Input type tied to its own parser and service call.
export const TOOLS = {
  create_problems: {
    description:
      'Create one or more problems in an existing Problem Set (set_id) or an explicitly new one (new_set). Problems keep the given order, never overwrite existing ones, and do not change the problem the user is viewing. Retrying with the same request_id returns the original IDs.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    schema: createProblemsInput,
    parse: parseCreateProblems,
    write: true,
    call: async (input, services) => ok({ ...(await services.problems.create(input)) }),
  } satisfies Tool<ReturnType<typeof parseCreateProblems>>,

  list_problems: {
    description:
      'List problems with Collection/Set metadata, answer state, latest committed Snapshot ID, its review status and trend. Does not include images. Paginate with next_cursor.',
    annotations: { readOnlyHint: true, openWorldHint: false },
    schema: listProblemsInput,
    parse: parseListProblems,
    write: false,
    call: async (input, services) => ok({ ...(await services.problems.list(input)) }),
  } satisfies Tool<ReturnType<typeof parseListProblems>>,

  get_submission: {
    description:
      'Return the latest committed handwritten Snapshot of a problem as an image, with the question and Snapshot metadata. Never returns an unfinished draft; when answer_state is "working", has_unsubmitted_changes tells whether the user has edited since this Snapshot. Returns status "not_ready" when nothing has been submitted.',
    annotations: { readOnlyHint: true, openWorldHint: false },
    schema: getSubmissionInput,
    parse: parseGetSubmission,
    write: false,
    call: async ({ problem_id }, services) => {
      const submission = await services.submissions.latest(problem_id);
      if (submission.status === 'not_ready') return ok({ ...submission });
      const { image, ...metadata } = submission;
      return {
        content: [text(metadata), { type: 'image', mimeType: image.mimeType, data: image.data }],
        structuredContent: metadata,
      };
    },
  } satisfies Tool<ReturnType<typeof parseGetSubmission>>,

  append_feedback: {
    description:
      'Append feedback to the exact Snapshot you reviewed (snapshot_id from get_submission). Never overwrites earlier feedback; feedback for older Snapshots is kept as history. verdict is optional. Supply idempotency_key to make retries safe.',
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    schema: appendFeedbackInput,
    parse: parseAppendFeedback,
    write: true,
    call: async (input, services) => ok({ ...(await services.feedback.append(input)) }),
  } satisfies Tool<ReturnType<typeof parseAppendFeedback>>,
};

export type ToolName = keyof typeof TOOLS;

export function isToolName(name: unknown): name is ToolName {
  return typeof name === 'string' && Object.hasOwn(TOOLS, name);
}

/**
 * Run one tool call. Every failure after the tool is found — bad arguments, missing scope, domain
 * errors, unexpected exceptions — becomes an `isError` result, so the model sees what went wrong.
 * Services are created only here, so discovery requests never construct them.
 */
export async function callTool(
  name: ToolName,
  args: unknown,
  owner: McpIdentity,
  services: () => Services,
): Promise<ToolResult> {
  const tool: Tool<unknown> = TOOLS[name];
  try {
    if (tool.write) owner.requireScope('mcp:write');
    return await tool.call(tool.parse(args), services());
  } catch (error) {
    const failure = errorPayload(error);
    if (!(error instanceof DomainError || error instanceof HttpError))
      console.error('mcp_tool_error', (error as Error)?.name);
    return { isError: true, content: [text(failure)], structuredContent: failure };
  }
}

/**
 * Tool registry — registers all P02A MCP tools on a per-request McpServer.
 *
 * Source: agent_flow/implementation/v1/02-cross-cutting-architecture.md §4
 *
 * Per the trust boundary, tools call domain services ONLY — never the DB
 * directly. Each tool handler:
 *   1. enforces scope (read vs write_agent_state) — wired by the caller via the
 *      scope each tool declares
 *   2. runs its domain service(s) with the token's workspaceId
 *   3. returns the phase-02 §4.3 envelope as MCP tool content
 *
 * Tools are registered per-request so the authenticated {db, workspaceId, actor}
 * is captured by closure — no cross-request state, no session, fully stateless.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DbClient } from "@statehub/db";
import type { ActorContext, TokenScope, VerifiedToken } from "@statehub/domain";
import { requireScope, ForbiddenError } from "@statehub/domain";
import type { ApiResult } from "@statehub/shared";
import { toToolError } from "./errors";
import {
  getCurrentFocus,
  getCurrentFocusShape,
  getCurrentFocusDescription,
} from "./tools/get-current-focus";
import {
  getFeatureContext,
  getFeatureContextShape,
  getFeatureContextDescription,
} from "./tools/get-feature-context";
import {
  startAgentRun,
  startAgentRunShape,
  startAgentRunDescription,
} from "./tools/start-agent-run";
import {
  completeAgentRun,
  completeAgentRunShape,
  completeAgentRunDescription,
} from "./tools/complete-agent-run";
import {
  upsertWorkItems,
  upsertWorkItemsShape,
  upsertWorkItemsDescription,
} from "./tools/upsert-work-items";
import {
  upsertTodos,
  upsertTodosShape,
  upsertTodosDescription,
} from "./tools/upsert-todos";
import {
  updateTodoStatus,
  updateTodoStatusShape,
  updateTodoStatusDescription,
} from "./tools/update-todo-status";
import {
  submitReview,
  submitReviewShape,
  submitReviewDescription,
} from "./tools/submit-review";
import {
  createFollowupTodosFromReview,
  createFollowupTodosFromReviewShape,
  createFollowupTodosFromReviewDescription,
} from "./tools/create-followup-todos-from-review";
import {
  startAgentRunLocal,
  startAgentRunLocalShape,
  startAgentRunLocalDescription,
} from "./tools/start-agent-run-local";
import {
  completeAgentRunLocal,
  completeAgentRunLocalShape,
  completeAgentRunLocalDescription,
} from "./tools/complete-agent-run-local";

/** Per-request authenticated context, captured into tool closures. */
export interface ToolContext {
  db: DbClient;
  workspaceId: string;
  actor: ActorContext;
  token: VerifiedToken;
}

/** Wrap an envelope result as MCP CallToolResult content. */
function toContent(result: ApiResult<unknown>) {
  const text = JSON.stringify(result);
  return {
    content: [{ type: "text" as const, text }],
    isError: !result.ok,
  };
}

/**
 * Wrap a tool handler with a scope guard. The token (captured in ctx) must have
 * the required scope, else we short-circuit with a scope_missing envelope — the
 * domain service never runs. This enforces acceptance #7 (a token without
 * write_agent_state cannot start/complete runs).
 */
function withScope(
  ctx: ToolContext,
  scope: TokenScope,
  run: () => Promise<ApiResult<unknown>>,
): Promise<{ content: { type: "text"; text: string }[]; isError: boolean }> {
  try {
    requireScope(ctx.token, scope);
  } catch (e) {
    // A scope failure is 'scope_missing' (not generic 'forbidden') so agents get
    // the precise code named in acceptance #11 and the error-codes registry.
    if (e instanceof ForbiddenError) {
      return Promise.resolve(
        toContent({
          ok: false,
          error_code: "scope_missing",
          message: e.message,
          retryable: false,
        }),
      );
    }
    return Promise.resolve(toContent(toToolError(e)));
  }
  return run().then(toContent);
}

/** One tool registration spec: shape + handler + required scope. */
interface ToolSpec {
  name: string;
  description: string;
  scope: TokenScope;
  shape: Record<string, unknown>;
  run: (ctx: ToolContext, args: Record<string, unknown>) => Promise<ApiResult<unknown>>;
}

const TOOLS: ToolSpec[] = [
  {
    name: "get_current_focus",
    description: getCurrentFocusDescription,
    scope: "read",
    shape: getCurrentFocusShape,
    run: (ctx, args) => getCurrentFocus(ctx.db, ctx.workspaceId, ctx.actor, args as never),
  },
  {
    name: "get_feature_context",
    description: getFeatureContextDescription,
    scope: "read",
    shape: getFeatureContextShape,
    run: (ctx, args) => getFeatureContext(ctx.db, ctx.workspaceId, ctx.actor, args as never),
  },
  {
    name: "start_agent_run",
    description: startAgentRunDescription,
    scope: "write_agent_state",
    shape: startAgentRunShape,
    run: (ctx, args) => startAgentRun(ctx.db, ctx.workspaceId, ctx.actor, args as never),
  },
  {
    name: "complete_agent_run",
    description: completeAgentRunDescription,
    scope: "write_agent_state",
    shape: completeAgentRunShape,
    run: (ctx, args) => completeAgentRun(ctx.db, ctx.workspaceId, ctx.actor, args as never),
  },
  {
    name: "upsert_work_items",
    description: upsertWorkItemsDescription,
    scope: "write_agent_state",
    shape: upsertWorkItemsShape,
    run: (ctx, args) => upsertWorkItems(ctx.db, ctx.workspaceId, ctx.actor, args as never),
  },
  {
    name: "upsert_todos",
    description: upsertTodosDescription,
    scope: "write_agent_state",
    shape: upsertTodosShape,
    run: (ctx, args) => upsertTodos(ctx.db, ctx.workspaceId, ctx.actor, args as never),
  },
  {
    name: "update_todo_status",
    description: updateTodoStatusDescription,
    scope: "write_agent_state",
    shape: updateTodoStatusShape,
    run: (ctx, args) => updateTodoStatus(ctx.db, ctx.workspaceId, ctx.actor, args as never),
  },
  {
    name: "submit_review",
    description: submitReviewDescription,
    scope: "write_agent_state",
    shape: submitReviewShape,
    run: (ctx, args) => submitReview(ctx.db, ctx.workspaceId, ctx.actor, args as never),
  },
  {
    name: "create_followup_todos_from_review",
    description: createFollowupTodosFromReviewDescription,
    scope: "write_agent_state",
    shape: createFollowupTodosFromReviewShape,
    run: (ctx, args) => createFollowupTodosFromReview(ctx.db, ctx.workspaceId, ctx.actor, args as never),
  },
  {
    name: "start_agent_run_local",
    description: startAgentRunLocalDescription,
    scope: "write_agent_state",
    shape: startAgentRunLocalShape,
    run: (ctx, args) => startAgentRunLocal(ctx.db, ctx.workspaceId, ctx.actor, args as never),
  },
  {
    name: "complete_agent_run_local",
    description: completeAgentRunLocalDescription,
    scope: "write_agent_state",
    shape: completeAgentRunLocalShape,
    run: (ctx, args) => completeAgentRunLocal(ctx.db, ctx.workspaceId, ctx.actor, args as never),
  },
];

/**
 * Build a fresh McpServer with all P02A tools registered against the given
 * authenticated context. Stateless — one server per request.
 */
export function buildServer(ctx: ToolContext): McpServer {
  const server = new McpServer(
    { name: "statehub-mcp-remote", version: "0.1.0" },
    { capabilities: { logging: {} } },
  );

  for (const tool of TOOLS) {
    server.tool(
      tool.name,
      tool.description,
      tool.shape,
      async (args: Record<string, unknown>) => withScope(ctx, tool.scope, () => tool.run(ctx, args)),
    );
  }

  return server;
}

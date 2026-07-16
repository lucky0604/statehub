/**
 * Tool registry — registers all P04B local MCP tools on a single McpServer.
 *
 * Source: agent_flow/implementation/v1/phases/phase-04-local-mcp-sidecar.md §4
 *
 * Unlike mcp-remote (which builds a fresh McpServer per HTTP request), the
 * local sidecar builds ONE McpServer at startup and serves it over stdio for
 * the process lifetime. The ToolContext (config + resolved ids + cwd) is
 * captured into each tool closure.
 *
 * All tools return the canonical ApiResult envelope as JSON-stringified text
 * content — same wire format as mcp-remote.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ApiResult } from "@statehub/shared";
import type { ToolContext } from "./context.js";
import {
  getLocalRepoContext,
  getLocalRepoContextShape,
  getLocalRepoContextDescription,
} from "./tools/get-local-repo-context.js";
import {
  collectGitEvidence,
  collectGitEvidenceShape,
  collectGitEvidenceDescription,
} from "./tools/collect-git-evidence.js";
import {
  recordTestCommand,
  recordTestCommandShape,
  recordTestCommandDescription,
} from "./tools/record-test-command.js";
import {
  syncEvidence,
  syncEvidenceShape,
  syncEvidenceDescription,
} from "./tools/sync-evidence.js";
import {
  startAgentRunLocal,
  startAgentRunLocalShape,
  startAgentRunLocalDescription,
} from "./tools/start-agent-run-local.js";
import {
  completeAgentRunLocal,
  completeAgentRunLocalShape,
  completeAgentRunLocalDescription,
} from "./tools/complete-agent-run-local.js";

/** Wrap an envelope result as MCP CallToolResult content. */
function toContent(result: ApiResult<unknown>) {
  const text = JSON.stringify(result);
  return {
    content: [{ type: "text" as const, text }],
    isError: !result.ok,
  };
}

interface ToolSpec {
  name: string;
  description: string;
  shape: Record<string, unknown>;
  run: (ctx: ToolContext, args: Record<string, unknown>) => Promise<ApiResult<unknown>> | ApiResult<unknown>;
}

const TOOLS: ToolSpec[] = [
  {
    name: "get_local_repo_context",
    description: getLocalRepoContextDescription,
    shape: getLocalRepoContextShape,
    run: (ctx) => getLocalRepoContext(ctx),
  },
  {
    name: "collect_git_evidence",
    description: collectGitEvidenceDescription,
    shape: collectGitEvidenceShape,
    run: (ctx, args) => collectGitEvidence(ctx, args as never),
  },
  {
    name: "record_test_command",
    description: recordTestCommandDescription,
    shape: recordTestCommandShape,
    run: (_ctx, args) => recordTestCommand(args as never),
  },
  {
    name: "sync_evidence",
    description: syncEvidenceDescription,
    shape: syncEvidenceShape,
    run: (ctx, args) => syncEvidence(ctx, args as never),
  },
  {
    name: "start_agent_run_local",
    description: startAgentRunLocalDescription,
    shape: startAgentRunLocalShape,
    run: (ctx, args) => startAgentRunLocal(ctx, args as never),
  },
  {
    name: "complete_agent_run_local",
    description: completeAgentRunLocalDescription,
    shape: completeAgentRunLocalShape,
    run: (ctx, args) => completeAgentRunLocal(ctx, args as never),
  },
];

/** Build the McpServer with all P04B tools registered against ctx. */
export function buildServer(ctx: ToolContext): McpServer {
  const server = new McpServer(
    { name: "statehub-mcp-local", version: "0.1.0" },
    { capabilities: { logging: {} } },
  );

  for (const tool of TOOLS) {
    server.tool(
      tool.name,
      tool.description,
      tool.shape,
      async (args: Record<string, unknown>) => {
        try {
          const result = await tool.run(ctx, args);
          return toContent(result);
        } catch (e) {
          // Tools are expected to catch their own errors and return err()
          // envelopes; this is a defensive net for any that slip through.
          const msg = e instanceof Error ? e.message : String(e);
          return toContent({
            ok: false,
            error_code: "internal_error",
            message: `tool ${tool.name} threw: ${msg}`,
            retryable: false,
          } as ApiResult<never>);
        }
      },
    );
  }

  return server;
}

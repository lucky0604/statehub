/**
 * Per-process tool context — captured into tool closures when the McpServer is
 * built at startup. Mirrors mcp-remote's ToolContext but with the local
 * sidecar's dependencies (config + resolved ids + repo identity) instead of a
 * DbClient.
 *
 * Source: agent_flow/implementation/v1/phases/phase-04-local-mcp-sidecar.md §4
 */
import type { LocalConfig } from "./config.js";
import type { ResolvedContext } from "./remote-client.js";

export interface ToolContext {
  config: LocalConfig;
  resolved: ResolvedContext;
  /** Repo working directory — usually process.cwd(), overridable for tests. */
  cwd: string;
}

#!/usr/bin/env node
/**
 * mcp-local — Node stdio MCP sidecar for StateHub.
 *
 * Source: agent_flow/implementation/v1/phases/phase-04-local-mcp-sidecar.md §2, §7
 *         agent_flow/implementation/v1/iterations/20260716-p04b-local-sidecar/plan.md §0
 *
 * Reads .statehub/config.json from process.cwd() (or --config <path>), resolves
 * the workspace + project slugs against Remote StateHub once at startup, then
 * serves the six P04B MCP tools over stdio.
 *
 * The token is read from process.env[config.tokenEnv] AT REQUEST TIME inside
 * remote-client.ts — the sidecar picks up rotated tokens without a restart.
 *
 * Usage:
 *   pnpm --filter @statehub/mcp-local dev
 *   STATEHUB_TOKEN=<token> node dist/index.js [--config /path/to/config.json]
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, ConfigError } from "./config.js";
import { resolveProjectBySlugs, fetchProjectRepoIdentity } from "./remote-client.js";
import { buildServer } from "./registry.js";
import type { ToolContext } from "./context.js";

function parseArgs(argv: string[]): { configPath?: string } {
  const out: { configPath?: string } = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--config" || a === "-c") {
      out.configPath = argv[++i];
    } else if (a.startsWith("--config=")) {
      out.configPath = a.slice("--config=".length);
    } else if (a === "--help" || a === "-h") {
      process.stderr.write(`usage: mcp-local [--config <path>]\n  --config  Path to .statehub/config.json (default: <cwd>/.statehub/config.json)\n`);
      process.exit(0);
    }
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  let config;
  try {
    config = loadConfig(args.configPath);
  } catch (e) {
    if (e instanceof ConfigError) {
      process.stderr.write(`[mcp-local] config error: ${e.message}\n`);
      process.exit(1);
    }
    throw e;
  }

  // Resolve slugs → ids + fetch project repo identity once at startup.
  // Failures here are fatal — the sidecar can't do anything useful without
  // a valid project binding. We log to stderr (stdout is reserved for MCP).
  const cache: { workspaceId?: string; projectId?: string } = {};
  let resolved;
  try {
    const ids = await resolveProjectBySlugs(config, cache);
    const identity = await fetchProjectRepoIdentity(config, ids);
    resolved = { ids, identity };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`[mcp-local] failed to resolve project: ${msg}\n`);
    process.exit(2);
  }

  const ctx: ToolContext = {
    config,
    resolved,
    cwd: process.cwd(),
  };

  const server = buildServer(ctx);
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // StdioServerTransport keeps the process alive on its stdin listener.
  // Log startup to stderr only — stdout is the MCP channel.
  process.stderr.write(
    `[mcp-local] serving 6 tools for ${config.workspaceSlug}/${config.projectSlug} (remote: ${config.remoteUrl})\n`,
  );
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  process.stderr.write(`[mcp-local] fatal: ${msg}\n`);
  process.exit(1);
});

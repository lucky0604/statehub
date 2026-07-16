/**
 * mcp-remote — Cloudflare Worker exposing StateHub over the MCP Streamable HTTP
 * transport.
 *
 * Source: agent_flow/implementation/v1/phases/phase-02-minimum-agent-sync-loop.md §4, §5
 *         agent_flow/implementation/v1/02-cross-cutting-architecture.md §4 (write flow)
 *
 * Single endpoint: POST /mcp. Auth via Bearer personal token. Stateless: each
 * request gets a fresh transport + a fresh McpServer whose tool handlers close
 * over the authenticated {db, workspaceId, token, actor}. No session, no SSE.
 *
 * The Worker imports @statehub/domain + @statehub/db directly (same monorepo),
 * shares the D1 binding with the web app, and NEVER touches DB tables outside
 * the domain services — preserving the trust boundary.
 */
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createD1Client } from "@statehub/db";
import { authenticate } from "./auth";
import { buildServer } from "./registry";

export interface Env {
  DB: D1Database;
}

/** JSON-RPC error response (matches MCP SDK's error shape). */
function jsonrpcError(code: number, message: string, status: number): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }),
    { status, headers: { "content-type": "application/json" } },
  );
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname !== "/mcp") {
      return jsonrpcError(-32001, "not found; MCP endpoint is POST /mcp", 404);
    }

    // Stateless server: GET (SSE stream) and DELETE (session close) are not used.
    if (req.method !== "POST") {
      return jsonrpcError(-32000, "method not allowed; use POST", 405);
    }

    // Build a D1-backed DbClient directly. The Worker never imports the
    // Node-only getDb()/better-sqlite3 path — that keeps the bundle clean.
    const db = createD1Client(env.DB);

    // Authenticate at the HTTP boundary. A missing/invalid token is rejected
    // before the MCP transport even parses the JSON-RPC body — so initialize
    // AND every tool call require a valid token.
    const auth = await authenticate(db, req.headers.get("authorization"));
    if (!auth.ok) {
      return jsonrpcError(-32001, `${auth.code}: ${auth.message}`, auth.status);
    }

    try {
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless
      });
      const server = buildServer({
        db,
        workspaceId: auth.token.workspaceId,
        actor: auth.actor,
        token: auth.token,
      });
      await server.connect(transport);
      const response = await transport.handleRequest(req);
      // Stateless: close immediately. No session to keep alive.
      await server.close();
      return response;
    } catch (e) {
      console.error("[mcp] request failed:", e);
      return jsonrpcError(-32603, "internal error", 500);
    }
  },
};

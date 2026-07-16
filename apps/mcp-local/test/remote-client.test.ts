/**
 * Tests for the HTTP remote-client wrapper — uses a mocked global fetch.
 *
 * Source: agent_flow/implementation/v1/iterations/20260716-p04b-local-sidecar/plan.md §2.5, §4 (acceptance #5, #6, #7)
 *
 * Verifies:
 *   - Token is read from process.env[config.tokenEnv] at request time.
 *   - Bearer token is REDACTED from any thrown error message (acceptance #7).
 *   - Idempotency-Key header is sent on writes.
 *   - resolveProjectBySlugs caches across calls.
 *   - postLocalEvidence + callMcpTool parse responses correctly.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  resolveProjectBySlugs,
  fetchProjectRepoIdentity,
  postLocalEvidence,
  callMcpTool,
  RemoteError,
  TokenMissingError,
  type LocalConfig,
} from "../src/remote-client";

const CONFIG: LocalConfig = {
  remoteUrl: "http://localhost:3000",
  workspaceSlug: "personal",
  projectSlug: "kavis",
  tokenEnv: "STATEHUB_TOKEN",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function jsonRpcResponse(id: number, result: unknown): Response {
  const text = JSON.stringify(result);
  return jsonResponse(200, {
    jsonrpc: "2.0",
    id,
    result: { content: [{ type: "text", text }], isError: false },
  });
}

interface FetchCall {
  url: string;
  init: RequestInit;
}

describe("remote-client", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let calls: FetchCall[];
  let handler: (url: string, init: RequestInit) => Promise<Response>;
  let originalToken: string | undefined;

  beforeEach(() => {
    calls = [];
    handler = async () => jsonResponse(404, { ok: false, error_code: "not_found", message: "no mock" });
    fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = url.toString();
      const i = init ?? {};
      calls.push({ url: u, init: i });
      return handler(u, i);
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    originalToken = process.env.STATEHUB_TOKEN;
    process.env.STATEHUB_TOKEN = "test-token-12345";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalToken === undefined) {
      delete process.env.STATEHUB_TOKEN;
    } else {
      process.env.STATEHUB_TOKEN = originalToken;
    }
  });

  /** Default handler that resolves the slug pair successfully. URL-based so
   * it works across multiple resolveProjectBySlugs calls. */
  function happyPathHandler(): typeof handler {
    return async (url) => {
      if (url.endsWith("/api/workspaces")) {
        return jsonResponse(200, { ok: true, data: [{ id: "ws-1", slug: "personal" }] });
      }
      return jsonResponse(200, { ok: true, data: [{ id: "proj-1", slug: "kavis" }] });
    };
  }

  describe("token handling", () => {
    it("sends Bearer token from process.env[config.tokenEnv]", async () => {
      handler = happyPathHandler();
      await resolveProjectBySlugs(CONFIG);
      const headers = calls[0]!.init.headers as Record<string, string>;
      expect(headers.authorization).toBe("Bearer test-token-12345");
    });

    it("throws TokenMissingError when env var is not set", async () => {
      delete process.env.STATEHUB_TOKEN;
      await expect(resolveProjectBySlugs(CONFIG)).rejects.toThrow(TokenMissingError);
    });

    it("picks up a rotated token without re-instantiating the client", async () => {
      handler = happyPathHandler();
      await resolveProjectBySlugs(CONFIG);
      expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer test-token-12345");

      process.env.STATEHUB_TOKEN = "rotated-token-67890";
      calls.length = 0;
      await resolveProjectBySlugs(CONFIG);
      expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer rotated-token-67890");
    });
  });

  describe("error redaction (acceptance #7)", () => {
    it("redacts Bearer token from non-2xx error messages", async () => {
      handler = async () =>
        jsonResponse(500, { ok: false, error_code: "internal_error", message: "Bearer test-token-12345 leaked" });

      await expect(resolveProjectBySlugs(CONFIG)).rejects.toThrow();
      try {
        await resolveProjectBySlugs(CONFIG);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        expect(msg).not.toContain("test-token-12345");
        expect(msg).toContain("Bearer <redacted>");
      }
    });

    it("redacts Bearer token from network errors", async () => {
      handler = async () => {
        throw new Error("network failure with Bearer test-token-12345 in message");
      };

      await expect(resolveProjectBySlugs(CONFIG)).rejects.toThrow();
      try {
        await resolveProjectBySlugs(CONFIG);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        expect(msg).not.toContain("test-token-12345");
        expect(msg).toContain("Bearer <redacted>");
      }
    });
  });

  describe("resolveProjectBySlugs", () => {
    it("resolves wid+pid from slug pair", async () => {
      handler = happyPathHandler();

      const ids = await resolveProjectBySlugs(CONFIG);
      expect(ids).toEqual({ workspaceId: "ws-1", projectId: "proj-1" });
      expect(calls[0]!.url).toContain("/api/workspaces");
      expect(calls[1]!.url).toContain("/api/workspaces/ws-1/projects");
    });

    it("throws when workspace slug not found", async () => {
      handler = async () => jsonResponse(200, { ok: true, data: [{ id: "ws-1", slug: "other" }] });
      await expect(resolveProjectBySlugs(CONFIG)).rejects.toThrow(/no workspace with slug "personal"/);
    });

    it("throws when project slug not found", async () => {
      let call = 0;
      handler = async () => {
        call++;
        if (call === 1) return jsonResponse(200, { ok: true, data: [{ id: "ws-1", slug: "personal" }] });
        return jsonResponse(200, { ok: true, data: [{ id: "proj-1", slug: "other" }] });
      };
      await expect(resolveProjectBySlugs(CONFIG)).rejects.toThrow(/no project with slug "kavis"/);
    });

    it("caches resolved ids across calls (no second fetch)", async () => {
      let call = 0;
      handler = async () => {
        call++;
        if (call === 1) return jsonResponse(200, { ok: true, data: [{ id: "ws-1", slug: "personal" }] });
        return jsonResponse(200, { ok: true, data: [{ id: "proj-1", slug: "kavis" }] });
      };

      const cache: { workspaceId?: string; projectId?: string } = {};
      await resolveProjectBySlugs(CONFIG, cache);
      await resolveProjectBySlugs(CONFIG, cache);
      expect(call).toBe(2); // no additional fetches
    });
  });

  describe("fetchProjectRepoIdentity", () => {
    it("returns repoUrl + aliases", async () => {
      let call = 0;
      handler = async () => {
        call++;
        if (call === 1) {
          return jsonResponse(200, { ok: true, data: { repoUrl: "git@github.com:owner/kavis.git" } });
        }
        return jsonResponse(200, {
          ok: true,
          data: [{ aliasUrl: "https://github.com/owner/kavis" }, { aliasUrl: "git@github.com:owner/kavis-fork.git" }],
        });
      };

      const identity = await fetchProjectRepoIdentity(CONFIG, { workspaceId: "ws-1", projectId: "proj-1" });
      expect(identity.repoUrl).toBe("git@github.com:owner/kavis.git");
      expect(identity.aliases).toEqual(["https://github.com/owner/kavis", "git@github.com:owner/kavis-fork.git"]);
    });

    it("returns null repoUrl when project has none", async () => {
      let call = 0;
      handler = async () => {
        call++;
        if (call === 1) return jsonResponse(200, { ok: true, data: {} });
        return jsonResponse(200, { ok: true, data: [] });
      };

      const identity = await fetchProjectRepoIdentity(CONFIG, { workspaceId: "ws-1", projectId: "proj-1" });
      expect(identity.repoUrl).toBeNull();
      expect(identity.aliases).toEqual([]);
    });
  });

  describe("postLocalEvidence", () => {
    it("POSTs with Idempotency-Key header (acceptance #5)", async () => {
      handler = async () =>
        jsonResponse(200, {
          ok: true,
          data: { evidence_id: "ev-1", trust_state: "working_tree", staleness_state: "fresh", match_status: "matched" },
        });

      const res = await postLocalEvidence(
        CONFIG,
        { workspaceId: "ws-1", projectId: "proj-1" },
        { title: "test", evidence_type: "test_result" },
        "idem-key-1",
      );

      expect(res.ok).toBe(true);
      expect(res.data!.evidence_id).toBe("ev-1");
      const headers = calls[0]!.init.headers as Record<string, string>;
      expect(headers["idempotency-key"]).toBe("idem-key-1");
      expect(headers.authorization).toBe("Bearer test-token-12345");
      expect(calls[0]!.init.method).toBe("POST");
      expect(calls[0]!.url).toContain("/api/workspaces/ws-1/projects/proj-1/local-evidence");
    });

    it("throws RemoteError on non-2xx, preserving error_code", async () => {
      handler = async () =>
        jsonResponse(409, { ok: false, error_code: "repo_conflict", message: "URL bound to another project" });

      await expect(
        postLocalEvidence(
          CONFIG,
          { workspaceId: "ws-1", projectId: "proj-1" },
          { title: "test", evidence_type: "test_result" },
          "idem-key-1",
        ),
      ).rejects.toThrow(RemoteError);

      try {
        await postLocalEvidence(
          CONFIG,
          { workspaceId: "ws-1", projectId: "proj-1" },
          { title: "test", evidence_type: "test_result" },
          "idem-key-1",
        );
      } catch (e) {
        expect(e instanceof RemoteError).toBe(true);
        expect((e as RemoteError).code).toBe("repo_conflict");
        expect((e as RemoteError).status).toBe(409);
        expect((e as RemoteError).message).toBe("URL bound to another project");
      }
    });
  });

  describe("callMcpTool", () => {
    it("POSTs JSON-RPC tools/call and parses the envelope", async () => {
      handler = async () => jsonRpcResponse(1, { ok: true, data: { run_id: "run-1", status: "running" } });

      const res = await callMcpTool(CONFIG, "start_agent_run_local", { agent: "opencode", run_type: "implement" });

      expect(res).toEqual({ ok: true, data: { run_id: "run-1", status: "running" } });
      expect(calls[0]!.init.method).toBe("POST");
      expect(calls[0]!.url).toContain("/mcp");

      const body = JSON.parse(calls[0]!.init.body as string) as { method: string; params: { name: string } };
      expect(body.method).toBe("tools/call");
      expect(body.params.name).toBe("start_agent_run_local");
    });

    it("throws RemoteError on JSON-RPC error", async () => {
      handler = async () =>
        jsonResponse(200, {
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32603, message: "internal error" },
        });

      await expect(callMcpTool(CONFIG, "start_agent_run_local", {})).rejects.toThrow(RemoteError);
    });
  });
});

/**
 * HTTP wrapper for talking to Remote StateHub from the local sidecar.
 *
 * Source: agent_flow/implementation/v1/phases/phase-04-local-mcp-sidecar.md §5
 *         agent_flow/implementation/v1/iterations/20260716-p04b-local-sidecar/plan.md §2.5, §2.6
 *
 * Design rules:
 *   1. The token is read from process.env[config.tokenEnv] AT REQUEST TIME, not
 *      at client construction. A long-running sidecar picks up rotated tokens
 *      without a restart. The token is NEVER stored on the client object.
 *   2. The Authorization header is REDACTED from any error message — a thrown
 *      Error's message must never contain the bearer token. Token leakage via
 *      logs is the #1 risk called out in the P04B plan §6.
 *   3. Idempotency-Key is passed through for write endpoints.
 *   4. No retry, no streaming — the agent (OpenCode/Codex) owns retry policy.
 */
import type { LocalConfig } from "./config.js";

export type { LocalConfig };

/** Bearer token missing from the environment. */
export class TokenMissingError extends Error {
  constructor(public tokenEnv: string) {
    super(`config.tokenEnv "${tokenEnv}" is not set in the environment`);
    this.name = "TokenMissingError";
  }
}

/** Remote returned a non-2xx response. `message` is redacted of Authorization. */
export class RemoteError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public extras?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "RemoteError";
  }
}

/** Resolved identifiers, cached in-memory for the process lifetime. */
export interface ResolvedIds {
  workspaceId: string;
  projectId: string;
}

/** Project's repo identity — used for client-side match_status computation. */
export interface ProjectRepoIdentity {
  repoUrl: string | null;
  aliases: string[];
}

/** Cached state for the process lifetime — ids + project repo identity. */
export interface ResolvedContext {
  ids: ResolvedIds;
  identity: ProjectRepoIdentity;
}

/** Reads the token from process.env at request time. Throws if missing. */
function readToken(config: LocalConfig): string {
  const tok = process.env[config.tokenEnv];
  if (!tok || !tok.trim()) {
    throw new TokenMissingError(config.tokenEnv);
  }
  return tok.trim();
}

/** Strip Bearer token from any string (URL, header dump, body preview). */
function redact(input: string): string {
  // Matches "Bearer <token>" anywhere in the string, case-insensitive.
  return input.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer <redacted>");
}

/** Build an absolute URL from config.remoteUrl + path. */
function buildUrl(config: LocalConfig, path: string): string {
  const base = config.remoteUrl.replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

/** Sanitize an error's message before rethrow — redact any Bearer substring. */
function sanitizeError(e: unknown, context: string): RemoteError {
  if (e instanceof RemoteError) return e;
  const raw = e instanceof Error ? e.message : String(e);
  return new RemoteError(0, "internal_error", `${context}: ${redact(raw)}`);
}

/** Common fetch wrapper with auth + redaction. */
async function fetchJson<T>(
  config: LocalConfig,
  path: string,
  init: RequestInit & { idempotencyKey?: string } = {},
): Promise<T> {
  const token = readToken(config);
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    accept: "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (init.body) headers["content-type"] = "application/json";
  if (init.idempotencyKey) headers["idempotency-key"] = init.idempotencyKey;

  let res: Response;
  try {
    res = await fetch(buildUrl(config, path), {
      method: init.method ?? "GET",
      headers,
      body: init.body,
    });
  } catch (e) {
    // Network error — no HTTP status, but redact just in case.
    throw sanitizeError(e, `network error fetching ${path}`);
  }

  const text = await res.text();
  if (!res.ok) {
    // Try to parse the error envelope, then redact.
    let code = `http_${res.status}`;
    let message = text;
    let extras: Record<string, unknown> | undefined;
    try {
      const parsed = JSON.parse(text) as { error_code?: string; message?: string; [k: string]: unknown };
      if (parsed.error_code) code = parsed.error_code;
      if (parsed.message) message = parsed.message;
      const { error_code: _ec, message: _m, ...rest } = parsed;
      if (Object.keys(rest).length > 0) extras = rest;
    } catch {
      // Non-JSON error body — keep raw text (redacted).
    }
    throw new RemoteError(res.status, code, redact(message), extras);
  }

  try {
    return JSON.parse(text) as T;
  } catch (e) {
    throw sanitizeError(e, `invalid JSON from ${path}`);
  }
}

/**
 * Resolve workspaceId + projectId from the config's slug pair.
 *
 * Fetches GET /api/workspaces (full list — the web route doesn't support ?slug)
 * and GET /api/workspaces/<wid>/projects, then finds by slug. Cached on the
 * passed-in cache map for the process lifetime.
 *
 * Note: these GET routes currently don't enforce Bearer auth. The write
 * endpoints (local-evidence, MCP) DO — so a slug lookup that resolves to a
 * workspace the token can't access will still be rejected at write time.
 */
export async function resolveProjectBySlugs(
  config: LocalConfig,
  cache: { workspaceId?: string; projectId?: string } = {},
): Promise<ResolvedIds> {
  if (cache.workspaceId && cache.projectId) {
    return { workspaceId: cache.workspaceId, projectId: cache.projectId };
  }

  // 1. Resolve workspace by slug.
  const wsEnvelope = await fetchJson<{
    ok: boolean;
    data?: Array<{ id: string; slug: string }>;
    error_code?: string;
    message?: string;
  }>(config, "/api/workspaces");
  if (!wsEnvelope.ok || !wsEnvelope.data) {
    throw new RemoteError(502, "external_source_error", `failed to list workspaces: ${wsEnvelope.message ?? "unknown"}`);
  }
  const ws = wsEnvelope.data.find((w) => w.slug === config.workspaceSlug);
  if (!ws) {
    throw new RemoteError(404, "not_found", `no workspace with slug "${config.workspaceSlug}"`);
  }

  // 2. Resolve project by slug within that workspace.
  const projEnvelope = await fetchJson<{
    ok: boolean;
    data?: Array<{ id: string; slug: string }>;
    error_code?: string;
    message?: string;
  }>(config, `/api/workspaces/${ws.id}/projects`);
  if (!projEnvelope.ok || !projEnvelope.data) {
    throw new RemoteError(502, "external_source_error", `failed to list projects: ${projEnvelope.message ?? "unknown"}`);
  }
  const proj = projEnvelope.data.find((p) => p.slug === config.projectSlug);
  if (!proj) {
    throw new RemoteError(404, "not_found", `no project with slug "${config.projectSlug}" in workspace "${config.workspaceSlug}"`);
  }

  cache.workspaceId = ws.id;
  cache.projectId = proj.id;
  return { workspaceId: ws.id, projectId: proj.id };
}

/**
 * Fetch the project's repo_url + aliases. Used at startup (after resolving
 * slugs) so get_local_repo_context can compute project_match_status client-side
 * without round-tripping on every call.
 */
export async function fetchProjectRepoIdentity(
  config: LocalConfig,
  ids: ResolvedIds,
): Promise<ProjectRepoIdentity> {
  const projEnvelope = await fetchJson<{
    ok: boolean;
    data?: { repoUrl?: string | null };
    error_code?: string;
    message?: string;
  }>(config, `/api/workspaces/${ids.workspaceId}/projects/${ids.projectId}`);
  if (!projEnvelope.ok) {
    throw new RemoteError(502, "external_source_error", `failed to fetch project: ${projEnvelope.message ?? "unknown"}`);
  }

  const aliasesEnvelope = await fetchJson<{
    ok: boolean;
    data?: Array<{ aliasUrl?: string }>;
    error_code?: string;
    message?: string;
  }>(config, `/api/workspaces/${ids.workspaceId}/projects/${ids.projectId}/repo-aliases`);
  if (!aliasesEnvelope.ok) {
    throw new RemoteError(502, "external_source_error", `failed to fetch repo aliases: ${aliasesEnvelope.message ?? "unknown"}`);
  }

  return {
    repoUrl: projEnvelope.data?.repoUrl ?? null,
    aliases: (aliasesEnvelope.data ?? []).map((a) => a.aliasUrl).filter((s): s is string => !!s),
  };
}

/** Shape of the local-evidence ingestion response. */
export interface LocalEvidenceResponse {
  ok: boolean;
  data?: {
    evidence_id: string;
    trust_state: string;
    staleness_state: string;
    match_status: string;
  };
  error_code?: string;
  message?: string;
  retryable?: boolean;
}

/** POST to /api/workspaces/<wid>/projects/<pid>/local-evidence. */
export async function postLocalEvidence(
  config: LocalConfig,
  ids: ResolvedIds,
  body: Record<string, unknown>,
  idempotencyKey: string,
): Promise<LocalEvidenceResponse> {
  return fetchJson<LocalEvidenceResponse>(
    config,
    `/api/workspaces/${ids.workspaceId}/projects/${ids.projectId}/local-evidence`,
    {
      method: "POST",
      body: JSON.stringify(body),
      idempotencyKey,
    },
  );
}

/** Shape of a JSON-RPC 2.0 response. */
interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: {
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  };
  error?: { code: number; message: string; data?: unknown };
}

/**
 * Call a remote MCP tool over JSON-RPC (POST /mcp).
 *
 * The remote tool's result content is a JSON-stringified envelope
 * (see mcp-remote/registry.ts toContent). We parse it back out and return.
 */
export async function callMcpTool<T = unknown>(
  config: LocalConfig,
  toolName: string,
  args: Record<string, unknown>,
): Promise<T> {
  const id = Math.floor(Math.random() * 1_000_000);
  const rpc = {
    jsonrpc: "2.0" as const,
    id,
    method: "tools/call",
    params: { name: toolName, arguments: args },
  };

  const res = await fetchJson<JsonRpcResponse>(config, "/mcp", {
    method: "POST",
    body: JSON.stringify(rpc),
  });

  if (res.error) {
    throw new RemoteError(0, "mcp_error", redact(res.error.message), {
      jsonrpc_code: res.error.code,
      data: res.error.data,
    });
  }
  if (!res.result || !res.result.content || res.result.content.length === 0) {
    throw new RemoteError(0, "mcp_error", `empty result from ${toolName}`);
  }
  const text = res.result.content[0]!.text;
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    throw sanitizeError(e, `invalid MCP result JSON from ${toolName}`);
  }
}

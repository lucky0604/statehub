/**
 * Local evidence ingestion — accepts evidence submitted by the local MCP
 * sidecar (P04B) with git context, derives trust + staleness, and records
 * the row.
 *
 * Source: agent_flow/implementation/v1/phases/phase-04-local-mcp-sidecar.md §5, §6
 *         agent_flow/implementation/v1/iterations/20260716-p04a-remote-repo-identity/plan.md §2.3
 *
 * Auth: Bearer personal token with `write_agent_state` scope.
 * Idempotent on the `Idempotency-Key` header (same key + same body → same
 * response, no duplicate write).
 *
 * This is the first web API route that uses Bearer auth (the rest are
 * internal, called from server components). The pattern mirrors mcp-remote's
 * auth + idempotency guard but inlined for a single HTTP endpoint.
 */
import {
  tokenService,
  requireScope,
  idempotencyService,
  hashRequest,
  localEvidenceService,
  remoteMcpActor,
  type EvidenceType,
  type ActorContext,
  DomainError,
} from "@statehub/domain";
import { ok, err, type ApiResult } from "@statehub/shared";
import { db } from "@/lib/server";

export const runtime = "nodejs";

interface LocalEvidenceBody {
  project_id: string;
  repo_remote_url: string;
  git_branch?: string;
  base_sha?: string;
  head_sha?: string;
  dirty_state?: boolean;
  evidence_type: EvidenceType;
  title: string;
  summary?: string;
  payload_json?: string;
  artifact_url?: string;
  feature_id?: string;
  work_item_id?: string;
  agent_run_id?: string;
}

interface IngestResponse {
  evidence_id: string;
  trust_state: string;
  staleness_state: string;
  match_status: string;
}

function errorResponse(code: string, message: string, status: number): Response {
  return Response.json(err(code as never, message), { status });
}

export async function POST(req: Request, ctx: { params: Promise<{ wid: string; pid: string }> }):
  Promise<Response> {
  const params = await ctx.params;
  const wid = params.wid;
  const pid = params.pid;

  // 1. Authenticate via Bearer token.
  const authHeader = req.headers.get("authorization");
  const raw = extractBearer(authHeader);
  if (!raw) {
    return errorResponse("unauthorized", "missing or malformed Bearer token", 401);
  }
  const token = await tokenService.verify(db(), raw);
  if (!token) {
    return errorResponse("unauthorized", "invalid or revoked token", 401);
  }
  if (token.workspaceId !== wid) {
    return errorResponse("workspace_mismatch", "token does not match this workspace", 403);
  }
  try {
    requireScope(token, "write_agent_state");
  } catch (e) {
    const message = e instanceof DomainError ? e.message : "token lacks required scope: write_agent_state";
    return errorResponse("scope_missing", message, 403);
  }
  const actor: ActorContext = remoteMcpActor(token.name, token.tokenId);

  // 2. Parse body.
  let body: LocalEvidenceBody;
  try {
    body = (await req.json()) as LocalEvidenceBody;
  } catch {
    return errorResponse("validation_error", "request body is not valid JSON", 400);
  }
  if (!body.project_id) {
    return errorResponse("validation_error", "project_id is required", 400);
  }
  if (body.project_id !== pid) {
    return errorResponse("validation_error", "project_id in body must match the URL", 400);
  }
  if (!body.repo_remote_url) {
    return errorResponse("validation_error", "repo_remote_url is required", 400);
  }
  if (!body.title) {
    return errorResponse("validation_error", "title is required", 400);
  }
  if (!body.evidence_type) {
    return errorResponse("validation_error", "evidence_type is required", 400);
  }

  // 3. Idempotency check via Idempotency-Key header.
  const idemKey = req.headers.get("idempotency-key");
  if (!idemKey) {
    return errorResponse("validation_error", "Idempotency-Key header is required", 400);
  }
  const requestHash = await hashRequest(body);
  const hit = await idempotencyService.check(db(), wid, idemKey, requestHash);
  if (hit.hit) {
    const cached = hit.response as ApiResult<IngestResponse> | null;
    if (cached && typeof cached === "object" && "ok" in cached) {
      return Response.json(cached);
    }
    return Response.json(ok({ data: cached as unknown as IngestResponse }));
  }

  // 4. Ingest via domain service.
  try {
    const result = await localEvidenceService.ingest(db(), actor, wid, {
      projectId: pid,
      repoRemoteUrl: body.repo_remote_url,
      gitBranch: body.git_branch,
      baseSha: body.base_sha,
      headSha: body.head_sha,
      dirtyState: body.dirty_state,
      featureId: body.feature_id,
      workItemId: body.work_item_id,
      agentRunId: body.agent_run_id,
      evidenceType: body.evidence_type,
      title: body.title,
      summary: body.summary,
      payloadJson: body.payload_json,
      artifactUrl: body.artifact_url,
    });
    const response: ApiResult<IngestResponse> = ok({
      evidence_id: result.evidence.id,
      trust_state: result.trustState,
      staleness_state: result.stalenessState,
      match_status: result.matchStatus,
    });
    await idempotencyService.record(db(), wid, idemKey, "local_evidence", requestHash, response);
    return Response.json(response);
  } catch (e) {
    if (e instanceof DomainError) {
      const status = errorStatusFor(e.code);
      const response = err(e.code, e.message, e.extra);
      // Record the error so a replay returns the same error verbatim.
      await idempotencyService.record(db(), wid, idemKey, "local_evidence", requestHash, response);
      return Response.json(response, { status });
    }
    const msg = e instanceof Error ? e.message : "internal error";
    console.error("[local-evidence] unhandled error:", e);
    return Response.json(err("internal_error", msg), { status: 500 });
  }
}

function extractBearer(authHeader: string | null | undefined): string | null {
  if (!authHeader) return null;
  const parts = authHeader.trim().split(/\s+/);
  if (parts.length !== 2 || parts[0]!.toLowerCase() !== "bearer") return null;
  const tok = parts[1];
  return tok && tok.length > 0 ? tok : null;
}

function errorStatusFor(code: string): number {
  switch (code) {
    case "not_found":
      return 404;
    case "forbidden":
    case "scope_missing":
    case "unauthorized":
      return 403;
    case "conflict":
    case "repo_conflict":
    case "idempotency_conflict":
    case "workspace_mismatch":
    case "transition_not_allowed":
      return 409;
    case "validation_error":
      return 400;
    case "rate_limited":
      return 429;
    case "external_source_error":
      return 502;
    case "internal_error":
    default:
      return 500;
  }
}

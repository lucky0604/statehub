/**
 * MCP auth — Bearer token verification + scope guard.
 *
 * Source: agent_flow/implementation/v1/phases/phase-02-minimum-agent-sync-loop.md §5
 *         agent_flow/implementation/v1/02-cross-cutting-architecture.md §4 (MCP write flow)
 *
 * Flow:
 *   1. Extract the Bearer token from the Authorization header.
 *   2. tokenService.verify hashes it and resolves { workspaceId, scopes }.
 *   3. requireScope(token, scope) throws ForbiddenError if the scope is absent.
 *
 * The resolved workspace_id is the ONLY source of workspace identity for every
 * tool call. Agent-supplied project_id/feature_id are verified against it by
 * the domain services (lookupProject filters by workspace_id).
 */
import { tokenService, requireScope, type VerifiedToken } from "@statehub/domain";
import type { DbClient } from "@statehub/db";
import { DomainError, remoteMcpActor, type ActorContext } from "@statehub/domain";

/** Extract a Bearer token from an Authorization header, or null. */
export function extractBearer(authHeader: string | null | undefined): string | null {
  if (!authHeader) return null;
  const parts = authHeader.trim().split(/\s+/);
  if (parts.length !== 2 || parts[0]!.toLowerCase() !== "bearer") return null;
  const tok = parts[1];
  return tok && tok.length > 0 ? tok : null;
}

/** Result of authenticating a request — either a verified token or an auth error. */
export type AuthResult =
  | { ok: true; token: VerifiedToken; actor: ActorContext }
  | { ok: false; status: 401 | 403; code: string; message: string };

/**
 * Verify the bearer token against the DB and build the actor context.
 * Does NOT check scopes — the caller passes the required scope to requireScope.
 */
export async function authenticate(db: DbClient, authHeader: string | null | undefined): Promise<AuthResult> {
  const raw = extractBearer(authHeader);
  if (!raw) {
    return { ok: false, status: 401, code: "unauthorized", message: "missing or malformed Bearer token" };
  }
  const token = await tokenService.verify(db, raw);
  if (!token) {
    return { ok: false, status: 401, code: "unauthorized", message: "invalid or revoked token" };
  }
  const actor = remoteMcpActor(token.name, token.tokenId);
  return { ok: true, token, actor };
}

/**
 * Enforce that the authenticated token has the required scope.
 * Returns a 403 AuthResult on failure; throws never.
 */
export function authorize(token: VerifiedToken, scope: "read" | "write_agent_state"): AuthResult {
  try {
    requireScope(token, scope);
    return { ok: true, token, actor: remoteMcpActor(token.name, token.tokenId) };
  } catch (e) {
    const message = e instanceof DomainError ? e.message : `token lacks required scope: ${scope}`;
    return { ok: false, status: 403, code: "scope_missing", message };
  }
}

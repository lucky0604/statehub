/**
 * Token service — issue + verify workspace-scoped personal access tokens.
 *
 * Source: agent_flow/implementation/v1/phases/phase-02-minimum-agent-sync-loop.md §5
 *
 * The raw token is returned ONCE on issuance and never stored. We store a
 * SHA-256 hash + an 8-char prefix for display. A token resolves to exactly one
 * workspace_id, which gates every query the agent makes.
 *
 * Token format: `sth_<random>`. The prefix column stores the first 8 chars
 * (e.g. "sth_abc1") for the UI to show "sth_abc1…".
 */
import { type DbClient, type TokenScope, type SqlBindValue, withEvent } from "@statehub/db";
import { ForbiddenError, NotFoundError, ValidationError } from "../errors";

/** A verified token + the workspace + scopes it grants. */
export interface VerifiedToken {
  tokenId: string;
  workspaceId: string;
  scopes: TokenScope[];
  name: string;
}

export interface IssuedToken {
  tokenId: string;
  /** The raw token — shown ONCE. Store it client-side; it is never recoverable. */
  token: string;
  prefix: string;
  name: string;
  scopes: TokenScope[];
  workspaceId: string;
}

export interface TokenService {
  issue(
    db: DbClient,
    workspaceId: string,
    input: { name: string; scopes: TokenScope[]; createdBy?: string },
  ): Promise<IssuedToken>;
  /** Verify a raw token. Returns null if not found / revoked / expired. */
  verify(db: DbClient, rawToken: string): Promise<VerifiedToken | null>;
  revoke(db: DbClient, workspaceId: string, tokenId: string): Promise<void>;
  list(db: DbClient, workspaceId: string): Promise<{ id: string; name: string; prefix: string; scopes: TokenScope[]; lastUsedAt: number | null; createdAt: number }[]>;
}

const TOKEN_PREFIX = "sth_";

/** Generate a URL-safe random token. crypto.randomUUID gives 36 chars of entropy. */
function generateRawToken(): string {
  return TOKEN_PREFIX + crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().slice(0, 8);
}

/** SHA-256 hex hash, async (uses WebCrypto — works in Node + Workers). */
async function hashToken(raw: string): Promise<string> {
  const data = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function validateScopes(scopes: TokenScope[]): void {
  const valid: TokenScope[] = ["read", "write_agent_state", "write_review"];
  for (const s of scopes) {
    if (!valid.includes(s)) throw new ValidationError(`invalid scope: ${s}`);
  }
}

export const tokenService: TokenService = {
  async issue(db, workspaceId, input) {
    if (!input.name?.trim()) throw new ValidationError("name is required");
    validateScopes(input.scopes);

    const raw = generateRawToken();
    const hash = await hashToken(raw);
    const prefix = raw.slice(0, 8);
    const id = crypto.randomUUID();
    const scopesJson = JSON.stringify(input.scopes);

    await withEvent(
      db,
      {
        workspaceId,
        entityType: "token",
        entityId: id,
        eventType: "token.issued",
        actor: { type: "user", id: input.createdBy, name: "user" },
        source: "user",
        payload: { id, name: input.name, prefix, scopes: input.scopes },
      },
      () => [
        {
          sql: `INSERT INTO personal_tokens (id, workspace_id, name, token_hash, prefix, scopes_json, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
          params: [
            id,
            workspaceId,
            input.name,
            hash,
            prefix,
            scopesJson,
            input.createdBy ?? null,
          ] as SqlBindValue[],
        },
      ],
    );

    return {
      tokenId: id,
      token: raw,
      prefix,
      name: input.name,
      scopes: input.scopes,
      workspaceId,
    };
  },

  async verify(db, rawToken) {
    if (!rawToken) return null;
    const hash = await hashToken(rawToken);
    const row = await db.first<{
      id: string;
      workspace_id: string;
      name: string;
      scopes_json: string;
      revoked_at: number | null;
      expires_at: number | null;
    }>(
      `SELECT id, workspace_id, name, scopes_json, revoked_at, expires_at FROM personal_tokens WHERE token_hash = ?`,
      [hash],
    );
    if (!row) return null;
    if (row.revoked_at !== null) return null;
    if (row.expires_at !== null && row.expires_at < Date.now()) return null;

    // Update last_used_at (fire-and-forget; not in the event log).
    await db.run("UPDATE personal_tokens SET last_used_at = ? WHERE id = ?", [
      Date.now(),
      row.id,
    ]);

    let scopes: TokenScope[] = [];
    try {
      scopes = JSON.parse(row.scopes_json) as TokenScope[];
    } catch {
      scopes = [];
    }
    return { tokenId: row.id, workspaceId: row.workspace_id, scopes, name: row.name };
  },

  async revoke(db, workspaceId, tokenId) {
    const row = await db.first<{ id: string }>(
      "SELECT id FROM personal_tokens WHERE id = ? AND workspace_id = ? AND revoked_at IS NULL",
      [tokenId, workspaceId],
    );
    if (!row) throw new NotFoundError("token", tokenId);
    await withEvent(
      db,
      {
        workspaceId,
        entityType: "token",
        entityId: tokenId,
        eventType: "token.revoked",
        actor: { type: "user", name: "user" },
        source: "user",
        payload: { id: tokenId },
      },
      () => [
        {
          sql: "UPDATE personal_tokens SET revoked_at = ? WHERE id = ? AND workspace_id = ?",
          params: [Date.now(), tokenId, workspaceId] as SqlBindValue[],
        },
      ],
    );
  },

  async list(db, workspaceId) {
    const rows = await db.all<{
      id: string;
      name: string;
      prefix: string;
      scopes_json: string;
      last_used_at: number | null;
      created_at: number;
    }>(
      "SELECT id, name, prefix, scopes_json, last_used_at, created_at FROM personal_tokens WHERE workspace_id = ? AND revoked_at IS NULL ORDER BY created_at DESC",
      [workspaceId],
    );
    return rows.map((r) => {
      let scopes: TokenScope[] = [];
      try {
        scopes = JSON.parse(r.scopes_json) as TokenScope[];
      } catch {
        scopes = [];
      }
      return {
        id: r.id,
        name: r.name,
        prefix: r.prefix,
        scopes,
        lastUsedAt: r.last_used_at,
        createdAt: r.created_at,
      };
    });
  },
};

/** Assert a verified token has a required scope, else 403. */
export function requireScope(token: VerifiedToken, scope: TokenScope): void {
  if (!token.scopes.includes(scope)) {
    throw new ForbiddenError(`token lacks required scope: ${scope}`);
  }
}

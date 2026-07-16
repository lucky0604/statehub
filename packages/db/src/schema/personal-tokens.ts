/**
 * personal_tokens table — workspace-scoped auth tokens for remote agents.
 *
 * Source: agent_flow/implementation/v1/phases/phase-02-minimum-agent-sync-loop.md §5
 *
 * The raw token is returned ONCE on issuance and never stored. We store a
 * SHA-256 hash plus an 8-char prefix for display ("sth_abc123…"). scopes_json
 * is a JSON array: ['read', 'write_agent_state', 'write_review'].
 *
 * Token is workspace-scoped: the resolved workspace_id gates every query the
 * agent makes. A token cannot reach across workspaces.
 */
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const TOKEN_SCOPES = ["read", "write_agent_state", "write_review"] as const;
export type TokenScope = (typeof TOKEN_SCOPES)[number];

export const personalTokens = sqliteTable(
  "personal_tokens",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    name: text("name").notNull(),
    /** SHA-256 hex of the raw token. */
    tokenHash: text("token_hash").notNull(),
    /** First 8 chars of the raw token, for display ("sth_abc1…"). */
    prefix: text("prefix").notNull(),
    /** JSON array of TokenScope. */
    scopesJson: text("scopes_json").notNull().default("[]"),
    lastUsedAt: integer("last_used_at"),
    expiresAt: integer("expires_at"),
    revokedAt: integer("revoked_at"),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    createdBy: text("created_by"),
  },
  (table) => [
    uniqueIndex("idx_tokens_hash").on(table.tokenHash),
    index("idx_tokens_workspace").on(table.workspaceId),
  ],
);

export type PersonalToken = typeof personalTokens.$inferSelect;
export type NewPersonalToken = typeof personalTokens.$inferInsert;

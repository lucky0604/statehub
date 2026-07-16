/**
 * project_repo_aliases — alternate remote URLs accepted as identity matches
 * for a project (e.g. ssh + https forms of the same GitHub repo).
 *
 * Source: agent_flow/implementation/v1/phases/phase-04-local-mcp-sidecar.md §3, §5
 *
 * The local MCP sidecar sends `repo_remote_url` with each evidence payload.
 * The remote compares its normalized form against projects.repo_url and
 * project_repo_aliases.alias_url. A match means the evidence is trusted-by-
 * identity; a non-match means untrusted (or, if it matches a different
 * project in the same workspace, repo_conflict).
 *
 * alias_url is stored already normalized via normalizeRepoUrl(); the UNIQUE
 * index on (workspace_id, alias_url) prevents the same alias being attached
 * to two projects in the same workspace.
 */
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const projectRepoAliases = sqliteTable(
  "project_repo_aliases",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    projectId: text("project_id").notNull(),
    aliasUrl: text("alias_url").notNull(),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    createdBy: text("created_by"),
  },
  (table) => [
    uniqueIndex("idx_repo_aliases_ws_url").on(table.workspaceId, table.aliasUrl),
    index("idx_repo_aliases_ws_project").on(table.workspaceId, table.projectId),
  ],
);

export type ProjectRepoAlias = typeof projectRepoAliases.$inferSelect;
export type NewProjectRepoAlias = typeof projectRepoAliases.$inferInsert;

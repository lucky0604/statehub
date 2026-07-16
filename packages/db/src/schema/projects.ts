/**
 * projects table — workspace-scoped project container.
 *
 * Source: agent_flow/implementation/v1/03-data-contracts-and-db-invariants.md §2, §3, §4
 *         agent_flow/implementation/v1/phases/phase-01-plane-like-core-project-health-summary.md §2
 *         agent_flow/prd/v1.md §8.1 (project type/status/priority)
 *
 * identifier: 3-6 char uppercase code (KAVIS, SH, TF) used in work item IDs (KAVIS-1).
 * Partial unique on (workspace_id, slug) and (workspace_id, identifier).
 *
 * Portfolio metadata (P01C):
 *   type               — what kind of project (open_source, commercial, ...)
 *   status             — lifecycle state (active, paused, shipped, ...)
 *   portfolioPriority  — this-week ranking (P0 mainline, P1 secondary, P2 maintain, Parked)
 */
import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const PROJECT_TYPES = [
  "open_source",
  "commercial",
  "personal",
  "infra",
  "research",
  "mcp",
] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

export const PROJECT_STATUSES = [
  "active",
  "paused",
  "shipped",
  "archived",
  "incubating",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PORTFOLIO_PRIORITIES = ["P0", "P1", "P2", "Parked"] as const;
export type PortfolioPriority = (typeof PORTFOLIO_PRIORITIES)[number];

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    identifier: text("identifier").notNull(),
    defaultStateId: text("default_state_id"),
    defaultAssigneeId: text("default_assignee_id"),
    type: text("type", { enum: PROJECT_TYPES }),
    status: text("status", { enum: PROJECT_STATUSES }).notNull().default("active"),
    portfolioPriority: text("portfolio_priority", { enum: PORTFOLIO_PRIORITIES })
      .notNull()
      .default("P1"),
    repoUrl: text("repo_url"),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    deletedAt: integer("deleted_at"),
    version: integer("version").notNull().default(1),
    createdBy: text("created_by"),
    updatedBy: text("updated_by"),
  },
  (table) => [
    uniqueIndex("idx_projects_ws_slug")
      .on(table.workspaceId, table.slug)
      .where(sql`deleted_at IS NULL`),
    uniqueIndex("idx_projects_ws_identifier")
      .on(table.workspaceId, table.identifier)
      .where(sql`deleted_at IS NULL`),
  ],
);

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

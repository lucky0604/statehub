/**
 * external_links table — generic tie between a StateHub entity and an
 * external resource (PR URL, issue URL, etc.).
 *
 * Source: agent_flow/implementation/v1/phases/phase-06-import-integration.md
 *         §4.3 (external_links), §3 principle 3 (every imported entity
 *         stores external_source and external_id).
 *
 * P06A scope: only the external_links table. The integrations / import_jobs /
 * sync_conflicts tables land in P06B when we add the GitHub Issues import
 * flow that actually needs them.
 *
 * The (workspace_id, entity_type, entity_id, external_source, external_id)
 * UNIQUE constraint gives idempotency for free: re-linking the same PR to
 * the same feature returns the existing row rather than creating a duplicate.
 *
 * entity_type is one of: project | feature | work_item | review_finding |
 * evidence | decision. We don't FK to each of those tables because the
 * entity_type is polymorphic; the service layer validates existence.
 */
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const EXTERNAL_SOURCES = ["github_pr", "github_issue", "plane", "linear", "manual"] as const;

export type ExternalSource = (typeof EXTERNAL_SOURCES)[number];

export const EXTERNAL_LINK_STATUSES = ["linked", "syncing", "conflict", "stale"] as const;

export type ExternalLinkStatus = (typeof EXTERNAL_LINK_STATUSES)[number];

export const externalLinks = sqliteTable(
  "external_links",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    projectId: text("project_id"),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    externalSource: text("external_source", { enum: EXTERNAL_SOURCES }).notNull(),
    externalId: text("external_id").notNull(),
    externalUrl: text("external_url").notNull(),
    syncStatus: text("sync_status", { enum: EXTERNAL_LINK_STATUSES })
      .notNull()
      .default("linked"),
    lastSyncedAt: integer("last_synced_at"),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    createdBy: text("created_by"),
  },
  (table) => [
    uniqueIndex("idx_external_links_unique").on(
      table.workspaceId,
      table.entityType,
      table.entityId,
      table.externalSource,
      table.externalId,
    ),
    index("idx_external_links_workspace").on(table.workspaceId, table.createdAt),
    index("idx_external_links_entity").on(
      table.workspaceId,
      table.entityType,
      table.entityId,
    ),
    index("idx_external_links_project").on(table.workspaceId, table.projectId),
  ],
);

export type ExternalLink = typeof externalLinks.$inferSelect;
export type NewExternalLink = typeof externalLinks.$inferInsert;

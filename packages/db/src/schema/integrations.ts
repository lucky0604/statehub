/**
 * Integrations + import jobs — workspace-level config for an external
 * provider (GitHub repo, Plane workspace, Linear team) and the per-run
 * audit log of imports from that provider.
 *
 * Source: agent_flow/implementation/v1/phases/phase-06-import-integration.md
 *         §4.1 (integrations), §4.2 (import_jobs)
 *
 * P06B scope: GitHub provider only. Plane/Linear land in P06C.
 *
 * PAT (personal access token) is stored in config_json plaintext — same
 * trust model as personal_tokens (this is a local-only solo-dev app).
 * Events strip the PAT from their payloads; GET responses return pat:
 * null so it never leaves the server after creation.
 */
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const INTEGRATION_PROVIDERS = ["github", "plane", "linear", "markdown"] as const;
export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

export const INTEGRATION_STATUSES = ["active", "disabled", "error"] as const;
export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

export const IMPORT_JOB_STATUSES = [
  "created",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;
export type ImportJobStatus = (typeof IMPORT_JOB_STATUSES)[number];

export const integrations = sqliteTable(
  "integrations",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    provider: text("provider", { enum: INTEGRATION_PROVIDERS }).notNull(),
    name: text("name").notNull(),
    configJson: text("config_json").notNull(),
    status: text("status", { enum: INTEGRATION_STATUSES })
      .notNull()
      .default("active"),
    lastUsedAt: integer("last_used_at"),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    createdBy: text("created_by"),
  },
  (table) => [
    index("idx_integrations_workspace").on(table.workspaceId, table.createdAt),
    index("idx_integrations_provider").on(table.workspaceId, table.provider),
  ],
);

export type Integration = typeof integrations.$inferSelect;
export type NewIntegration = typeof integrations.$inferInsert;

export const importJobs = sqliteTable(
  "import_jobs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    projectId: text("project_id"),
    integrationId: text("integration_id").notNull(),
    provider: text("provider").notNull(),
    status: text("status", { enum: IMPORT_JOB_STATUSES }).notNull(),
    summaryJson: text("summary_json"),
    inputJson: text("input_json"),
    resultJson: text("result_json"),
    startedAt: integer("started_at"),
    finishedAt: integer("finished_at"),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    createdBy: text("created_by"),
  },
  (table) => [
    index("idx_import_jobs_workspace").on(table.workspaceId, table.createdAt),
    index("idx_import_jobs_integration").on(table.workspaceId, table.integrationId),
  ],
);

export type ImportJob = typeof importJobs.$inferSelect;
export type NewImportJob = typeof importJobs.$inferInsert;

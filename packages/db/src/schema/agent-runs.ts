/**
 * agent_runs table — one row per coding-agent execution.
 *
 * Source: agent_flow/implementation/v1/phases/phase-02-minimum-agent-sync-loop.md §3.1
 *         agent_flow/prd/v1.md §10 (complete_agent_run payload)
 *
 * An agent run is the audit unit for "an agent worked on this feature." It
 * carries the summary, files/commands/tests, risks, next steps, and an
 * evidence trust state. Status is a small state machine:
 *   running -> completed | failed | cancelled
 * complete_agent_run may only transition a running run (phase-02 §4.2.4).
 *
 * evidence_trust_state defaults to 'unknown'; complete_agent_run sets it to
 * 'working_tree' (agent-submitted, not git-verified). Git-verified 'trusted'
 * arrives in Phase 04 (local MCP sidecar).
 */
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const AGENT_RUN_STATUSES = ["running", "completed", "failed", "cancelled"] as const;
export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

export const EVIDENCE_TRUST_STATES = [
  "trusted",
  "working_tree",
  "untrusted",
  "unknown",
] as const;
export type EvidenceTrustState = (typeof EVIDENCE_TRUST_STATES)[number];

export const agentRuns = sqliteTable(
  "agent_runs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    projectId: text("project_id").notNull(),
    featureId: text("feature_id"),
    workItemId: text("work_item_id"),
    agent: text("agent").notNull(),
    model: text("model"),
    runType: text("run_type").notNull(),
    status: text("status", { enum: AGENT_RUN_STATUSES }).notNull().default("running"),
    summary: text("summary"),
    filesChangedJson: text("files_changed_json").notNull().default("[]"),
    commandsRunJson: text("commands_run_json").notNull().default("[]"),
    testResult: text("test_result"),
    commitSha: text("commit_sha"),
    baseSha: text("base_sha"),
    headSha: text("head_sha"),
    gitBranch: text("git_branch"),
    dirtyState: text("dirty_state"),
    repoRemoteUrl: text("repo_remote_url"),
    risksJson: text("risks_json").notNull().default("[]"),
    nextStepsJson: text("next_steps_json").notNull().default("[]"),
    rawArtifactUrl: text("raw_artifact_url"),
    evidenceTrustState: text("evidence_trust_state", { enum: EVIDENCE_TRUST_STATES })
      .notNull()
      .default("unknown"),
    startedAt: integer("started_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    finishedAt: integer("finished_at"),
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
    index("idx_agent_runs_workspace_project").on(table.workspaceId, table.projectId),
    index("idx_agent_runs_feature").on(table.workspaceId, table.featureId),
    index("idx_agent_runs_work_item").on(table.workspaceId, table.workItemId),
    index("idx_agent_runs_status").on(table.workspaceId, table.status, table.startedAt),
  ],
);

export type AgentRun = typeof agentRuns.$inferSelect;
export type NewAgentRun = typeof agentRuns.$inferInsert;

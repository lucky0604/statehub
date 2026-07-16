/**
 * evidence table — structured proof attached to a run / work item / feature.
 *
 * Source: agent_flow/implementation/v1/phases/phase-02-minimum-agent-sync-loop.md §3.3
 *         agent_flow/implementation/v1/03-data-contracts-and-db-invariants.md §9 (trust)
 *
 * Trust state (how much we believe the evidence):
 *   trusted        — git-verified (Phase 04 local sidecar)
 *   working_tree   — agent-submitted, matches a working tree (P02A default on submit)
 *   untrusted      — agent-submitted, unverifiable
 *   unknown        — not yet assessed
 *
 * Staleness state:
 *   fresh / stale / unknown
 *
 * Done Gate v0 (P02C): working_tree/unknown/untrusted evidence cannot
 * independently support "done".
 */
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { EVIDENCE_TRUST_STATES } from "./agent-runs";

export const EVIDENCE_STALENESS_STATES = ["fresh", "stale", "unknown"] as const;
export type EvidenceStalenessState = (typeof EVIDENCE_STALENESS_STATES)[number];

export const EVIDENCE_TYPES = [
  "agent_run",
  "test_result",
  "file_change",
  "command",
  "commit",
  "manual_check",
  "review_finding",
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export const evidence = sqliteTable(
  "evidence",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    projectId: text("project_id").notNull(),
    featureId: text("feature_id"),
    workItemId: text("work_item_id"),
    agentRunId: text("agent_run_id"),
    evidenceType: text("evidence_type", { enum: EVIDENCE_TYPES }).notNull(),
    title: text("title").notNull(),
    summary: text("summary"),
    payloadJson: text("payload_json").notNull().default("{}"),
    artifactUrl: text("artifact_url"),
    trustState: text("trust_state", { enum: EVIDENCE_TRUST_STATES })
      .notNull()
      .default("unknown"),
    stalenessState: text("staleness_state", { enum: EVIDENCE_STALENESS_STATES })
      .notNull()
      .default("unknown"),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    createdBy: text("created_by"),
  },
  (table) => [
    index("idx_evidence_workspace_project").on(table.workspaceId, table.projectId),
    index("idx_evidence_agent_run").on(table.workspaceId, table.agentRunId),
    index("idx_evidence_work_item").on(table.workspaceId, table.workItemId),
    index("idx_evidence_feature").on(table.workspaceId, table.featureId),
  ],
);

export type Evidence = typeof evidence.$inferSelect;
export type NewEvidence = typeof evidence.$inferInsert;

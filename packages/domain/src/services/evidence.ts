/**
 * Evidence service — structured proof attached to a run / work item / feature.
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
 * Staleness: fresh / stale / unknown.
 *
 * P02A ships create + link + list. create records an evidence.created event.
 * link attaches an existing evidence row to a feature/work_item/agent_run
 * (evidence.linked) — used when an agent associates proof it just produced with
 * the run it just completed. The agent-run service creates evidence inline on
 * complete; this service is the general-purpose path and the read path.
 */
import {
  type DbClient,
  type ActorContext,
  type Evidence,
  type EvidenceType,
  type EvidenceTrustState,
  type EvidenceStalenessState,
  type SqlBindValue,
  withEvent,
} from "@statehub/db";
import { mapEvidence } from "../mappers";
import { NotFoundError, ValidationError } from "../errors";

export interface CreateEvidenceInput {
  projectId: string;
  featureId?: string;
  workItemId?: string;
  agentRunId?: string;
  evidenceType: EvidenceType;
  title: string;
  summary?: string;
  payloadJson?: string;
  artifactUrl?: string;
  trustState?: EvidenceTrustState;
  stalenessState?: EvidenceStalenessState;
}

export interface EvidenceService {
  create(db: DbClient, actor: ActorContext, workspaceId: string, input: CreateEvidenceInput): Promise<Evidence>;
  link(
    db: DbClient,
    actor: ActorContext,
    workspaceId: string,
    evidenceId: string,
    target: { featureId?: string; workItemId?: string; agentRunId?: string },
  ): Promise<Evidence>;
  get(db: DbClient, workspaceId: string, evidenceId: string): Promise<Evidence | null>;
  listForAgentRun(db: DbClient, workspaceId: string, agentRunId: string): Promise<Evidence[]>;
  listForWorkItem(db: DbClient, workspaceId: string, workItemId: string): Promise<Evidence[]>;
  listForFeature(db: DbClient, workspaceId: string, featureId: string): Promise<Evidence[]>;
}

async function lookupProject(
  db: DbClient,
  workspaceId: string,
  projectId: string,
): Promise<{ id: string }> {
  const row = await db.first<{ id: string }>(
    "SELECT id FROM projects WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL",
    [projectId, workspaceId],
  );
  if (!row) throw new NotFoundError("project", projectId);
  return row;
}

export const evidenceService: EvidenceService = {
  async create(db, actor, workspaceId, input) {
    if (!input.title?.trim()) throw new ValidationError("title is required");
    if (!input.evidenceType) throw new ValidationError("evidence_type is required");
    await lookupProject(db, workspaceId, input.projectId);

    const id = crypto.randomUUID();
    const params: SqlBindValue[] = [
      id,
      workspaceId,
      input.projectId,
      input.featureId ?? null,
      input.workItemId ?? null,
      input.agentRunId ?? null,
      input.evidenceType,
      input.title,
      input.summary ?? null,
      input.payloadJson ?? "{}",
      input.artifactUrl ?? null,
      input.trustState ?? "unknown",
      input.stalenessState ?? "unknown",
      actor.id ?? null,
    ];

    await withEvent(
      db,
      {
        workspaceId,
        projectId: input.projectId,
        featureId: input.featureId,
        workItemId: input.workItemId,
        entityType: "evidence",
        entityId: id,
        eventType: "evidence.created",
        actor,
        source: actor.type,
        payload: {
          id,
          projectId: input.projectId,
          evidenceType: input.evidenceType,
          title: input.title,
          trustState: input.trustState ?? "unknown",
        },
      },
      () => [
        {
          sql: `INSERT INTO evidence (
            id, workspace_id, project_id, feature_id, work_item_id, agent_run_id,
            evidence_type, title, summary, payload_json, artifact_url,
            trust_state, staleness_state, created_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          params,
        },
      ],
    );

    const row = await db.first<Record<string, unknown>>("SELECT * FROM evidence WHERE id = ?", [id]);
    if (!row) throw new Error("evidence insert failed");
    return mapEvidence(row);
  },

  async link(db, actor, workspaceId, evidenceId, target) {
    const existing = await evidenceService.get(db, workspaceId, evidenceId);
    if (!existing) throw new NotFoundError("evidence", evidenceId);

    const sets: string[] = [];
    const params: SqlBindValue[] = [];
    if (target.featureId !== undefined) {
      sets.push("feature_id = ?");
      params.push(target.featureId);
    }
    if (target.workItemId !== undefined) {
      sets.push("work_item_id = ?");
      params.push(target.workItemId);
    }
    if (target.agentRunId !== undefined) {
      sets.push("agent_run_id = ?");
      params.push(target.agentRunId);
    }
    if (sets.length === 0) return existing;

    params.push(evidenceId);
    params.push(workspaceId);
    const updateSql = `UPDATE evidence SET ${sets.join(", ")} WHERE id = ? AND workspace_id = ?`;

    await withEvent(
      db,
      {
        workspaceId,
        projectId: existing.projectId,
        featureId: target.featureId ?? existing.featureId ?? undefined,
        workItemId: target.workItemId ?? existing.workItemId ?? undefined,
        entityType: "evidence",
        entityId: evidenceId,
        eventType: "evidence.linked",
        actor,
        source: actor.type,
        payload: {
          evidenceId,
          featureId: target.featureId ?? null,
          workItemId: target.workItemId ?? null,
          agentRunId: target.agentRunId ?? null,
        },
      },
      () => [{ sql: updateSql, params }],
    );

    const row = await db.first<Record<string, unknown>>("SELECT * FROM evidence WHERE id = ?", [evidenceId]);
    if (!row) throw new Error("evidence link failed");
    return mapEvidence(row);
  },

  async get(db, workspaceId, evidenceId) {
    const row = await db.first<Record<string, unknown>>(
      "SELECT * FROM evidence WHERE id = ? AND workspace_id = ?",
      [evidenceId, workspaceId],
    );
    return row ? mapEvidence(row) : null;
  },

  async listForAgentRun(db, workspaceId, agentRunId) {
    const rows = await db.all<Record<string, unknown>>(
      "SELECT * FROM evidence WHERE workspace_id = ? AND agent_run_id = ? ORDER BY created_at DESC",
      [workspaceId, agentRunId],
    );
    return rows.map(mapEvidence);
  },

  async listForWorkItem(db, workspaceId, workItemId) {
    const rows = await db.all<Record<string, unknown>>(
      "SELECT * FROM evidence WHERE workspace_id = ? AND work_item_id = ? ORDER BY created_at DESC",
      [workspaceId, workItemId],
    );
    return rows.map(mapEvidence);
  },

  async listForFeature(db, workspaceId, featureId) {
    const rows = await db.all<Record<string, unknown>>(
      "SELECT * FROM evidence WHERE workspace_id = ? AND feature_id = ? ORDER BY created_at DESC",
      [workspaceId, featureId],
    );
    return rows.map(mapEvidence);
  },
};

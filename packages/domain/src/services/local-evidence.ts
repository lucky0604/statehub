/**
 * Local evidence service — accepts evidence submitted by the local MCP
 * sidecar, derives trust + staleness from repo identity + dirty state, and
 * records the evidence row + event.
 *
 * Source: agent_flow/implementation/v1/phases/phase-04-local-mcp-sidecar.md §5, §6
 *
 * Trust derivation (phase-04 §5):
 *   matched        + dirty_state=false  → trusted
 *   matched        + dirty_state=true   → working_tree
 *   alias_matched  + dirty_state=false  → trusted
 *   alias_matched  + dirty_state=true   → working_tree
 *   unknown                            → untrusted
 *
 * If the repo_remote_url matches a DIFFERENT project in the same workspace,
 * that's a repo_conflict — reject (the local sidecar is configured against
 * the wrong project).
 *
 * Staleness derivation (phase-04 §6.2):
 *   fresh    — evidence payload's head_sha matches the project's latest
 *              known commit on the same branch (or no prior evidence to
 *              compare against)
 *   stale    — evidence predates the latest known file change for the
 *              feature/work_item (heuristic: latest_commit_ts in payload
 *              predates the newest evidence.created_at for the same target)
 *   unknown  — no comparison possible
 */
import {
  type DbClient,
  type ActorContext,
  type Evidence,
  type EvidenceTrustState,
  type EvidenceStalenessState,
  type EvidenceType,
  type SqlBindValue,
  withEvent,
} from "@statehub/db";
import { normalizeRepoUrl } from "@statehub/shared";
import { mapEvidence } from "../mappers";
import { NotFoundError, RepoConflictError, ValidationError } from "../errors";
import { repoAliasService } from "./repo-alias";

export type RepoMatchStatus = "matched" | "alias_matched" | "unknown";

export interface IngestLocalEvidenceInput {
  projectId: string;
  repoRemoteUrl: string;
  gitBranch?: string | null;
  baseSha?: string | null;
  headSha?: string | null;
  dirtyState?: boolean;
  featureId?: string | null;
  workItemId?: string | null;
  agentRunId?: string | null;
  evidenceType: EvidenceType;
  title: string;
  summary?: string;
  payloadJson?: string;
  artifactUrl?: string | null;
}

export interface IngestLocalEvidenceResult {
  evidence: Evidence;
  trustState: EvidenceTrustState;
  stalenessState: EvidenceStalenessState;
  matchStatus: RepoMatchStatus;
}

export interface LocalEvidenceService {
  ingest(
    db: DbClient,
    actor: ActorContext,
    workspaceId: string,
    input: IngestLocalEvidenceInput,
  ): Promise<IngestLocalEvidenceResult>;
  /** Exposed for agent-run service to reuse on complete_agent_run_local. */
  deriveTrust(
    matchStatus: RepoMatchStatus,
    dirtyState: boolean,
  ): EvidenceTrustState;
  deriveStaleness(
    db: DbClient,
    workspaceId: string,
    input: IngestLocalEvidenceInput,
  ): Promise<EvidenceStalenessState>;
}

async function lookupProject(
  db: DbClient,
  workspaceId: string,
  projectId: string,
): Promise<{ id: string; repo_url: string | null }> {
  const row = await db.first<{ id: string; repo_url: string | null }>(
    "SELECT id, repo_url FROM projects WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL",
    [projectId, workspaceId],
  );
  if (!row) throw new NotFoundError("project", projectId);
  return row;
}

export const localEvidenceService: LocalEvidenceService = {
  deriveTrust(matchStatus, dirtyState) {
    if (matchStatus === "unknown") return "untrusted";
    return dirtyState ? "working_tree" : "trusted";
  },

  async deriveStaleness(db, workspaceId, input) {
    // Heuristic: compare the payload's latest_commit_ts (if present) against
    // the newest evidence.created_at for the same target. If our new evidence
    // predates that, it's stale.
    if (!input.featureId && !input.workItemId) return "unknown";

    let payload: { latest_commit_ts?: number; head_sha?: string } = {};
    try {
      payload = input.payloadJson ? JSON.parse(input.payloadJson) : {};
    } catch {
      payload = {};
    }
    if (!payload.latest_commit_ts) return "unknown";

    const targetColumn = input.workItemId ? "work_item_id" : "feature_id";
    const targetId: string = (input.workItemId ?? input.featureId) as string;
    const latest = await db.first<{ created_at: number }>(
      `SELECT MAX(created_at) AS created_at FROM evidence WHERE workspace_id = ? AND ${targetColumn} = ? AND created_at < ?`,
      [workspaceId, targetId, Date.now()],
    );
    if (!latest?.created_at) return "fresh";
    return payload.latest_commit_ts >= latest.created_at ? "fresh" : "stale";
  },

  async ingest(db, actor, workspaceId, input) {
    if (!input.title?.trim()) throw new ValidationError("title is required");
    if (!input.evidenceType) throw new ValidationError("evidence_type is required");
    if (!input.repoRemoteUrl?.trim()) {
      throw new ValidationError("repo_remote_url is required");
    }
    const project = await lookupProject(db, workspaceId, input.projectId);
    const normalized = normalizeRepoUrl(input.repoRemoteUrl);

    // Determine match status against THIS project first.
    let matchStatus: RepoMatchStatus = "unknown";
    if (project.repo_url && project.repo_url === normalized) {
      matchStatus = "matched";
    } else {
      const aliases = await repoAliasService.list(db, workspaceId, input.projectId);
      if (aliases.some((a) => a.aliasUrl === normalized)) {
        matchStatus = "alias_matched";
      }
    }

    if (matchStatus === "unknown") {
      // Confirm it's not matching a DIFFERENT project in the same workspace
      // (which is a config conflict, not just unknown).
      const otherProject = await repoAliasService.resolveProjectByRepoUrl(db, workspaceId, normalized);
      const byRepoUrl = await db.first<{ id: string }>(
        "SELECT id FROM projects WHERE workspace_id = ? AND repo_url = ? AND id != ? AND deleted_at IS NULL",
        [workspaceId, normalized, input.projectId],
      );
      if (otherProject && otherProject.projectId !== input.projectId) {
        throw new RepoConflictError(
          `repo_remote_url matches a different project in this workspace: ${otherProject.projectId}`,
          { matchStatus: "conflict", otherProjectId: otherProject.projectId },
        );
      }
      if (byRepoUrl) {
        throw new RepoConflictError(
          `repo_remote_url matches a different project in this workspace: ${byRepoUrl.id}`,
          { matchStatus: "conflict", otherProjectId: byRepoUrl.id },
        );
      }
    }

    const dirtyState = input.dirtyState ?? false;
    const trustState = localEvidenceService.deriveTrust(matchStatus, dirtyState);
    const stalenessState = await localEvidenceService.deriveStaleness(db, workspaceId, input);

    // Merge the git context into the payload so the UI can render dirty warnings.
    const basePayload = input.payloadJson ? JSON.parse(input.payloadJson) : {};
    const mergedPayload = JSON.stringify({
      ...basePayload,
      git_context: {
        repo_remote_url: normalized,
        git_branch: input.gitBranch ?? null,
        base_sha: input.baseSha ?? null,
        head_sha: input.headSha ?? null,
        dirty_state: dirtyState,
        match_status: matchStatus,
      },
    });

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
      mergedPayload,
      input.artifactUrl ?? null,
      trustState,
      stalenessState,
      actor.id ?? null,
    ];

    await withEvent(
      db,
      {
        workspaceId,
        projectId: input.projectId,
        featureId: input.featureId ?? undefined,
        workItemId: input.workItemId ?? undefined,
        entityType: "evidence",
        entityId: id,
        eventType: "evidence.local_ingested",
        actor,
        source: actor.type,
        payload: {
          id,
          projectId: input.projectId,
          evidenceType: input.evidenceType,
          title: input.title,
          trustState,
          stalenessState,
          matchStatus,
          repoRemoteUrl: normalized,
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
    if (!row) throw new Error("evidence ingest failed");
    const evidence = mapEvidence(row);
    return { evidence, trustState, stalenessState, matchStatus };
  },
};

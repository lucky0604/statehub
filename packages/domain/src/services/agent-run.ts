/**
 * Agent run service — the audit unit for "an agent worked on this."
 *
 * Source: agent_flow/implementation/v1/phases/phase-02-minimum-agent-sync-loop.md §3.1, §4.2
 *         agent_flow/prd/v1.md §10 (start/complete_agent_run)
 *
 * Lifecycle: running -> completed | failed | cancelled.
 * complete_agent_run may only transition a running run (phase-02 §4.2.4) and
 * records from_status/to_status in the event payload.
 *
 * complete_agent_run also creates an evidence row (type 'agent_run') linked to
 * the run, with trust_state 'working_tree' — agent-submitted, not git-verified.
 * Git-verified 'trusted' arrives in Phase 04.
 *
 * Agent runs NEVER flip feature status to done (phase-02 §5). Done is UI-only.
 */
import {
  type DbClient,
  type ActorContext,
  type AgentRun,
  type AgentRunStatus,
  type Evidence,
  type EvidenceTrustState,
  type Todo,
  type SqlBindValue,
  withEvent,
} from "@statehub/db";
import { normalizeRepoUrl } from "@statehub/shared";
import { mapAgentRun, mapEvidence, mapTodo } from "../mappers";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { localEvidenceService, type RepoMatchStatus } from "./local-evidence";
import { repoAliasService } from "./repo-alias";

export interface StartAgentRunInput {
  projectId: string;
  featureId?: string;
  workItemId?: string;
  agent: string;
  model?: string;
  runType: string;
  /** Local sidecar (P04A) — git context captured at run start. */
  repoRemoteUrl?: string;
  gitBranch?: string;
  baseSha?: string;
  headSha?: string;
  dirtyState?: boolean;
}

export interface CompleteAgentRunInput {
  summary: string;
  filesChanged?: string[];
  commandsRun?: string[];
  testResult?: string;
  risks?: string[];
  nextSteps?: string[];
  commitSha?: string;
  baseSha?: string;
  headSha?: string;
  gitBranch?: string;
  /** Local sidecar (P04A) — git context at run complete. */
  repoRemoteUrl?: string;
  dirtyState?: boolean;
}

export interface AgentRunService {
  start(db: DbClient, actor: ActorContext, workspaceId: string, input: StartAgentRunInput): Promise<AgentRun>;
  complete(
    db: DbClient,
    actor: ActorContext,
    workspaceId: string,
    runId: string,
    input: CompleteAgentRunInput,
  ): Promise<AgentRun>;
  get(db: DbClient, workspaceId: string, runId: string): Promise<AgentRun | null>;
  /** A run + its linked evidence + its todos — for the AgentRunDetailDrawer. */
  getWithEvidence(
    db: DbClient,
    workspaceId: string,
    runId: string,
  ): Promise<{ run: AgentRun; evidence: Evidence[]; todos: Todo[] } | null>;
  listForFeature(db: DbClient, workspaceId: string, featureId: string, limit?: number): Promise<AgentRun[]>;
  listForProject(db: DbClient, workspaceId: string, projectId: string, limit?: number): Promise<AgentRun[]>;
  /** Workspace-wide recent runs — for the Agent Runs page and right rail. */
  listForWorkspace(db: DbClient, workspaceId: string, limit?: number): Promise<AgentRun[]>;
  /** Count of runs currently in 'running' status — for the MCP sync indicator. */
  countRunning(db: DbClient, workspaceId: string): Promise<number>;
}

/** Allowed terminal transitions from 'running'. */
const TERMINAL: AgentRunStatus[] = ["completed", "failed", "cancelled"];

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

export const agentRunService: AgentRunService = {
  async start(db, actor, workspaceId, input) {
    if (!input.agent?.trim()) throw new ValidationError("agent is required");
    if (!input.runType?.trim()) throw new ValidationError("run_type is required");
    await lookupProject(db, workspaceId, input.projectId);

    const id = crypto.randomUUID();
    const params: SqlBindValue[] = [
      id,
      workspaceId,
      input.projectId,
      input.featureId ?? null,
      input.workItemId ?? null,
      input.agent,
      input.model ?? null,
      input.runType,
      "running",
      "unknown", // evidence_trust_state
      input.repoRemoteUrl ? normalizeRepoUrl(input.repoRemoteUrl) : null,
      input.gitBranch ?? null,
      input.baseSha ?? null,
      input.headSha ?? null,
      input.dirtyState !== undefined ? String(input.dirtyState) : null,
      1,
      actor.id ?? null,
      actor.id ?? null,
    ];

    await withEvent(
      db,
      {
        workspaceId,
        projectId: input.projectId,
        featureId: input.featureId,
        workItemId: input.workItemId,
        entityType: "agent_run",
        entityId: id,
        eventType: "agent_run.started",
        actor,
        source: actor.type,
        payload: { id, projectId: input.projectId, featureId: input.featureId, agent: input.agent, runType: input.runType },
      },
      () => [
        {
          sql: `INSERT INTO agent_runs (
            id, workspace_id, project_id, feature_id, work_item_id,
            agent, model, run_type, status, evidence_trust_state,
            repo_remote_url, git_branch, base_sha, head_sha, dirty_state,
            version, created_by, updated_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          params,
        },
      ],
    );

    const row = await db.first<Record<string, unknown>>("SELECT * FROM agent_runs WHERE id = ?", [id]);
    if (!row) throw new Error("agent_run insert failed");
    return mapAgentRun(row);
  },

  async complete(db, actor, workspaceId, runId, input) {
    const existing = await agentRunService.get(db, workspaceId, runId);
    if (!existing) throw new NotFoundError("agent_run", runId);
    if (existing.status !== "running") {
      throw new ConflictError(
        `agent_run ${runId} is not running (status=${existing.status})`,
        { runId, status: existing.status },
      );
    }
    if (!input.summary?.trim()) throw new ValidationError("summary is required");

    const filesChangedJson = JSON.stringify(input.filesChanged ?? []);
    const commandsRunJson = JSON.stringify(input.commandsRun ?? []);
    const risksJson = JSON.stringify(input.risks ?? []);
    const nextStepsJson = JSON.stringify(input.nextSteps ?? []);
    const finishedAt = Date.now();

    // Derive the evidence trust state. P02A default is 'working_tree' (agent-
    // submitted, not git-verified). P04A: if repo_remote_url is supplied and
    // matches the project (or one of its aliases), flip to 'trusted' when the
    // working tree is clean, or 'working_tree' when dirty. Unknown repos stay
    // at 'working_tree' — the agent still did the work, we just can't verify
    // the repo identity.
    let trustState: EvidenceTrustState = "working_tree";
    const normalizedRepoUrl = input.repoRemoteUrl ? normalizeRepoUrl(input.repoRemoteUrl) : null;
    if (normalizedRepoUrl) {
      const project = await db.first<{ repo_url: string | null }>(
        "SELECT repo_url FROM projects WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL",
        [existing.projectId, workspaceId],
      );
      let matchStatus: RepoMatchStatus = "unknown";
      if (project?.repo_url && project.repo_url === normalizedRepoUrl) {
        matchStatus = "matched";
      } else {
        const aliases = await repoAliasService.list(db, workspaceId, existing.projectId);
        if (aliases.some((a) => a.aliasUrl === normalizedRepoUrl)) {
          matchStatus = "alias_matched";
        }
      }
      if (matchStatus !== "unknown") {
        trustState = localEvidenceService.deriveTrust(matchStatus, input.dirtyState ?? false);
      }
    }

    const updateSql = `UPDATE agent_runs SET
      status = 'completed', summary = ?, files_changed_json = ?, commands_run_json = ?,
      test_result = ?, risks_json = ?, next_steps_json = ?,
      commit_sha = ?, base_sha = ?, head_sha = ?, git_branch = ?,
      repo_remote_url = COALESCE(?, repo_remote_url),
      dirty_state = COALESCE(?, dirty_state),
      evidence_trust_state = ?, finished_at = ?,
      updated_at = unixepoch() * 1000, version = version + 1, updated_by = ?
      WHERE id = ? AND workspace_id = ? AND status = 'running'`;

    const updateParams: SqlBindValue[] = [
      input.summary,
      filesChangedJson,
      commandsRunJson,
      input.testResult ?? null,
      risksJson,
      nextStepsJson,
      input.commitSha ?? null,
      input.baseSha ?? null,
      input.headSha ?? null,
      input.gitBranch ?? null,
      normalizedRepoUrl,
      input.dirtyState !== undefined ? String(input.dirtyState) : null,
      trustState,
      finishedAt,
      actor.id ?? null,
      runId,
      workspaceId,
    ];

    // Evidence row + event, in the same atomic batch as the run update.
    const evidenceId = crypto.randomUUID();
    const evidencePayload = JSON.stringify({
      filesChanged: input.filesChanged ?? [],
      commandsRun: input.commandsRun ?? [],
      testResult: input.testResult ?? null,
      commitSha: input.commitSha ?? null,
      git_context: normalizedRepoUrl
        ? {
            repo_remote_url: normalizedRepoUrl,
            git_branch: input.gitBranch ?? null,
            base_sha: input.baseSha ?? null,
            head_sha: input.headSha ?? null,
            dirty_state: input.dirtyState ?? false,
          }
        : undefined,
    });

    await withEvent(
      db,
      {
        workspaceId,
        projectId: existing.projectId,
        featureId: existing.featureId ?? undefined,
        workItemId: existing.workItemId ?? undefined,
        entityType: "agent_run",
        entityId: runId,
        eventType: "agent_run.completed",
        actor,
        source: actor.type,
        payload: { from: "running", to: "completed", summary: input.summary, evidenceId, trustState },
      },
      () => [
        { sql: updateSql, params: updateParams },
        {
          sql: `INSERT INTO evidence (
            id, workspace_id, project_id, feature_id, work_item_id, agent_run_id,
            evidence_type, title, summary, payload_json, trust_state, staleness_state, created_by
          ) VALUES (?, ?, ?, ?, ?, ?, 'agent_run', ?, ?, ?, ?, 'fresh', ?)`,
          params: [
            evidenceId,
            workspaceId,
            existing.projectId,
            existing.featureId ?? null,
            existing.workItemId ?? null,
            runId,
            `Agent run: ${input.summary.slice(0, 80)}`,
            input.summary,
            evidencePayload,
            trustState,
            actor.id ?? null,
          ] as SqlBindValue[],
        },
      ],
    );

    const row = await db.first<Record<string, unknown>>("SELECT * FROM agent_runs WHERE id = ?", [runId]);
    if (!row) throw new Error("agent_run complete failed");
    return mapAgentRun(row);
  },

  async get(db, workspaceId, runId) {
    const row = await db.first<Record<string, unknown>>(
      "SELECT * FROM agent_runs WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL",
      [runId, workspaceId],
    );
    return row ? mapAgentRun(row) : null;
  },

  async getWithEvidence(db, workspaceId, runId) {
    const run = await agentRunService.get(db, workspaceId, runId);
    if (!run) return null;
    const [evRows, todoRows] = await Promise.all([
      db.all<Record<string, unknown>>(
        "SELECT * FROM evidence WHERE workspace_id = ? AND agent_run_id = ? ORDER BY created_at DESC",
        [workspaceId, runId],
      ),
      db.all<Record<string, unknown>>(
        "SELECT * FROM todos WHERE workspace_id = ? AND agent_run_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC",
        [workspaceId, runId],
      ),
    ]);
    return {
      run,
      evidence: evRows.map(mapEvidence),
      todos: todoRows.map(mapTodo),
    };
  },

  async listForFeature(db, workspaceId, featureId, limit = 20) {
    const cap = Math.min(limit, 100);
    const rows = await db.all<Record<string, unknown>>(
      "SELECT * FROM agent_runs WHERE workspace_id = ? AND feature_id = ? AND deleted_at IS NULL ORDER BY started_at DESC LIMIT ?",
      [workspaceId, featureId, cap],
    );
    return rows.map(mapAgentRun);
  },

  async listForProject(db, workspaceId, projectId, limit = 20) {
    const cap = Math.min(limit, 100);
    const rows = await db.all<Record<string, unknown>>(
      "SELECT * FROM agent_runs WHERE workspace_id = ? AND project_id = ? AND deleted_at IS NULL ORDER BY started_at DESC LIMIT ?",
      [workspaceId, projectId, cap],
    );
    return rows.map(mapAgentRun);
  },

  async listForWorkspace(db, workspaceId, limit = 50) {
    const cap = Math.min(limit, 200);
    const rows = await db.all<Record<string, unknown>>(
      "SELECT * FROM agent_runs WHERE workspace_id = ? AND deleted_at IS NULL ORDER BY started_at DESC LIMIT ?",
      [workspaceId, cap],
    );
    return rows.map(mapAgentRun);
  },

  async countRunning(db, workspaceId) {
    const row = await db.first<{ c: number }>(
      "SELECT COUNT(*) AS c FROM agent_runs WHERE workspace_id = ? AND status = 'running' AND deleted_at IS NULL",
      [workspaceId],
    );
    return row?.c ?? 0;
  },
};

void TERMINAL; // reserved for P02B/P02C cancel/fail transitions

/**
 * GitHub Issues importer — map GitHub issues to StateHub work items.
 *
 * Source: agent_flow/implementation/v1/phases/phase-06-import-integration.md
 *         §5.2 (GitHub mapping), §3 principle 5 (imports are idempotent)
 *
 * Idempotency: the importer checks `external_links` for an existing
 * (workspace_id, entity_type="work_item", external_source="github_issue",
 * external_id=issue.number) row. If found, the issue is skipped (not
 * re-created). Re-running the same import is a no-op.
 *
 * Conflict semantics (v1): "skip if already linked". The user can
 * manually delete the work item + link and re-import to force a
 * re-create. P06C adds real conflict resolution.
 *
 * The importer is pure — it takes a list of GithubIssue objects (the
 * UI is responsible for fetching them via the GitHub API or accepting
 * a JSON paste) and returns a preview or runs the import. No I/O
 * against GitHub from this service.
 */
import {
  type DbClient,
  type ActorContext,
  type ImportJob,
  type SqlBindValue,
  withEvent,
} from "@statehub/db";
import { mapImportJob } from "../mappers";
import { workItemService } from "./work-item";
import { externalLinkService } from "./external-link";
import { featureService } from "./feature";
import { stateService } from "./state";
import { NotFoundError, ValidationError } from "../errors";

/** Subset of the GitHub API issue shape — enough to map. */
export interface GithubIssue {
  number: number;
  title: string;
  body?: string | null;
  state: "open" | "closed";
  labels?: string[];
  html_url: string;
  user?: { login: string };
  created_at?: string;
  updated_at?: string;
  milestone?: { title: string } | null;
}

export interface ImportInput {
  projectId: string;
  stateId: string;
  issues: GithubIssue[];
}

export interface ImportPreviewItem {
  issueNumber: number;
  issueTitle: string;
  issueUrl: string;
  workItemTitle: string;
  workItemDescription: string;
  featureId: string | null;
  featureName: string | null;
}

export interface ImportSkipItem {
  issueNumber: number;
  issueTitle: string;
  existingWorkItemId: string;
}

export interface ImportErrorItem {
  issueNumber: number;
  message: string;
}

export interface ImportPreview {
  toCreate: ImportPreviewItem[];
  toSkip: ImportSkipItem[];
  errors: ImportErrorItem[];
}

export interface ImportRunItem {
  issueNumber: number;
  workItemId: string;
}

export interface ImportRunResult {
  jobId: string;
  created: ImportRunItem[];
  skipped: ImportSkipItem[];
  errors: ImportErrorItem[];
}

export interface GithubIssuesImporter {
  preview(
    db: DbClient,
    workspaceId: string,
    integrationId: string,
    input: ImportInput,
  ): Promise<ImportPreview>;
  run(
    db: DbClient,
    actor: ActorContext,
    workspaceId: string,
    integrationId: string,
    input: ImportInput,
  ): Promise<ImportRunResult>;
}

/**
 * Find an existing external_link for a github_issue by issue number.
 * Returns the linked work_item id, or null if not linked.
 */
async function findLinkedWorkItemId(
  db: DbClient,
  workspaceId: string,
  issueNumber: number,
): Promise<string | null> {
  const row = await db.first<{ entity_id: string }>(
    `SELECT entity_id FROM external_links
     WHERE workspace_id = ? AND entity_type = ? AND external_source = ? AND external_id = ?
     LIMIT 1`,
    [workspaceId, "work_item", "github_issue", String(issueNumber)],
  );
  return row?.entity_id ?? null;
}

/**
 * Build a description string from the issue body + labels + author.
 * Caps at 500 chars to keep work item descriptions readable.
 */
function buildDescription(issue: GithubIssue): string {
  const parts: string[] = [];
  if (issue.body?.trim()) {
    parts.push(issue.body.trim().slice(0, 400));
  }
  if (issue.labels?.length) {
    parts.push(`labels: ${issue.labels.join(", ")}`);
  }
  if (issue.user?.login) {
    parts.push(`(via @${issue.user.login})`);
  }
  return parts.join("\n\n").slice(0, 500);
}

/**
 * Resolve a milestone title to an existing feature by name (case-insensitive).
 * Returns null if no match — we don't auto-create features in v1.
 */
async function resolveMilestoneFeature(
  db: DbClient,
  workspaceId: string,
  projectId: string,
  milestone: { title: string } | null | undefined,
): Promise<{ id: string; name: string } | null> {
  if (!milestone?.title?.trim()) return null;
  const features = await featureService.list(db, workspaceId, projectId);
  const match = features.find(
    (f) => f.name.toLowerCase() === milestone.title.trim().toLowerCase(),
  );
  return match ? { id: match.id, name: match.name } : null;
}

/**
 * Validate the target project + state exist. Throws NotFoundError /
 * ValidationError early so we don't half-import then fail.
 */
async function validateTarget(
  db: DbClient,
  workspaceId: string,
  input: ImportInput,
): Promise<void> {
  if (!input.projectId?.trim()) throw new ValidationError("project_id is required");
  if (!input.stateId?.trim()) throw new ValidationError("state_id is required");

  const project = await db.first<{ id: string }>(
    "SELECT id FROM projects WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL",
    [input.projectId, workspaceId],
  );
  if (!project) throw new NotFoundError("project", input.projectId);

  const state = await stateService.get(db, workspaceId, input.stateId);
  if (!state) throw new NotFoundError("state", input.stateId);
  if (state.projectId !== input.projectId) {
    throw new ValidationError("state does not belong to the target project");
  }
}

export const githubIssuesImporter: GithubIssuesImporter = {
  async preview(db, workspaceId, _integrationId, input) {
    await validateTarget(db, workspaceId, input);

    const toCreate: ImportPreviewItem[] = [];
    const toSkip: ImportSkipItem[] = [];
    const errors: ImportErrorItem[] = [];

    for (const issue of input.issues) {
      if (!issue.title?.trim()) {
        errors.push({ issueNumber: issue.number, message: "issue has no title" });
        continue;
      }
      if (!issue.html_url?.trim()) {
        errors.push({ issueNumber: issue.number, message: "issue has no html_url" });
        continue;
      }

      const existing = await findLinkedWorkItemId(db, workspaceId, issue.number);
      if (existing) {
        toSkip.push({
          issueNumber: issue.number,
          issueTitle: issue.title,
          existingWorkItemId: existing,
        });
        continue;
      }

      const feature = await resolveMilestoneFeature(
        db,
        workspaceId,
        input.projectId,
        issue.milestone,
      );
      toCreate.push({
        issueNumber: issue.number,
        issueTitle: issue.title,
        issueUrl: issue.html_url,
        workItemTitle: issue.title,
        workItemDescription: buildDescription(issue),
        featureId: feature?.id ?? null,
        featureName: feature?.name ?? null,
      });
    }

    return { toCreate, toSkip, errors };
  },

  async run(db, actor, workspaceId, integrationId, input) {
    const previewResult = await githubIssuesImporter.preview(
      db,
      workspaceId,
      integrationId,
      input,
    );

    // Create the import_job row first — status=running.
    const jobId = crypto.randomUUID();
    const startedAt = Date.now();
    const inputJson = JSON.stringify({
      projectId: input.projectId,
      stateId: input.stateId,
      issueCount: input.issues.length,
      issueNumbers: input.issues.map((i) => i.number),
    });

    await db.run(
      `INSERT INTO import_jobs (
        id, workspace_id, project_id, integration_id, provider, status,
        input_json, started_at, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        jobId,
        workspaceId,
        input.projectId,
        integrationId,
        "github",
        "running",
        inputJson,
        startedAt,
        actor.id ?? null,
      ],
    );

    await withEvent(
      db,
      {
        workspaceId,
        projectId: input.projectId,
        entityType: "import_job",
        entityId: jobId,
        eventType: "import_job.started",
        actor,
        source: actor.type === "user" ? "user" : actor.type,
        payload: {
          after: {
            id: jobId,
            integrationId,
            provider: "github",
            issueCount: input.issues.length,
          },
        },
      },
      () => [], // no extra SQL — the import_job insert above is the mutation
    );

    const created: ImportRunItem[] = [];
    const skipped = previewResult.toSkip;
    const errors = [...previewResult.errors];

    for (const item of previewResult.toCreate) {
      try {
        const issue = input.issues.find((i) => i.number === item.issueNumber)!;
        const wi = await workItemService.create(db, actor, workspaceId, input.projectId, {
          title: item.workItemTitle,
          descriptionMarkdown: item.workItemDescription,
          type: "issue",
          priority: "medium",
          stateId: input.stateId,
          featureId: item.featureId ?? undefined,
          source: "import",
        });

        await externalLinkService.create(db, actor, workspaceId, {
          projectId: input.projectId,
          entityType: "work_item",
          entityId: wi.id,
          externalSource: "github_issue",
          externalId: String(issue.number),
          externalUrl: issue.html_url,
        });

        created.push({ issueNumber: issue.number, workItemId: wi.id });
      } catch (err) {
        errors.push({
          issueNumber: item.issueNumber,
          message: err instanceof Error ? err.message : "unknown error",
        });
      }
    }

    const finishedAt = Date.now();
    const summaryJson = JSON.stringify({
      created: created.length,
      skipped: skipped.length,
      errors: errors.length,
    });
    const resultJson = JSON.stringify({ created, skipped, errors });
    const finalStatus = errors.length === 0 ? "completed" : "completed";

    await db.run(
      `UPDATE import_jobs SET status = ?, summary_json = ?, result_json = ?, finished_at = ? WHERE id = ?`,
      [finalStatus, summaryJson, resultJson, finishedAt, jobId],
    );

    await withEvent(
      db,
      {
        workspaceId,
        projectId: input.projectId,
        entityType: "import_job",
        entityId: jobId,
        eventType: errors.length > 0 ? "import_job.failed" : "import_job.completed",
        actor,
        source: actor.type === "user" ? "user" : actor.type,
        payload: {
          after: {
            id: jobId,
            status: finalStatus,
            summary: { created: created.length, skipped: skipped.length, errors: errors.length },
          },
        },
      },
      () => [],
    );

    return { jobId, created, skipped, errors };
  },
};

/** List import jobs for a workspace (optionally filtered by integration). */
export async function listImportJobs(
  db: DbClient,
  workspaceId: string,
  filter?: { integrationId?: string; limit?: number },
): Promise<ImportJob[]> {
  const conditions = ["workspace_id = ?"];
  const params: SqlBindValue[] = [workspaceId];
  if (filter?.integrationId) {
    conditions.push("integration_id = ?");
    params.push(filter.integrationId);
  }
  const limit = filter?.limit ?? 50;
  const sql = `SELECT * FROM import_jobs WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT ?`;
  params.push(limit);
  const rows = await db.all<Record<string, unknown>>(sql, params);
  return rows.map(mapImportJob);
}

/** Get a single import job by id. */
export async function getImportJob(
  db: DbClient,
  workspaceId: string,
  jobId: string,
): Promise<ImportJob | null> {
  const row = await db.first<Record<string, unknown>>(
    "SELECT * FROM import_jobs WHERE id = ? AND workspace_id = ?",
    [jobId, workspaceId],
  );
  return row ? mapImportJob(row) : null;
}

/**
 * Linear issues importer — map Linear issues to StateHub work items.
 *
 * Source: agent_flow/implementation/v1/phases/phase-06-import-integration.md
 *         §5.3 (Linear mapping), §3 principle 5 (imports are idempotent)
 *
 * Same idempotency + conflict semantics as githubIssuesImporter (P06B):
 *   - Idempotency: check external_links for an existing
 *     (workspace_id, entity_type="work_item", external_source="linear",
 *     external_id=issue.id) row. If found, skip.
 *   - Conflict: "skip if already linked" — v1 rule.
 */
import {
  type DbClient,
  type ActorContext,
  withEvent,
} from "@statehub/db";
import { workItemService } from "./work-item";
import { externalLinkService } from "./external-link";
import { featureService } from "./feature";
import { stateService } from "./state";
import { NotFoundError, ValidationError } from "../errors";
import type {
  ImportPreview,
  ImportPreviewItem,
  ImportSkipItem,
  ImportErrorItem,
  ImportRunItem,
  ImportRunResult,
} from "./github-importer";

/** Input for a Linear import — same shape as ImportInput but with Linear issues. */
export interface LinearImportInput {
  projectId: string;
  stateId: string;
  issues: LinearIssue[];
}

/** Subset of the Linear API issue shape — enough to map. */
export interface LinearIssue {
  id: string;
  identifier: string; // "ABC-123"
  title: string;
  description?: string | null;
  state?: { name: string; type: "backlog" | "unstarted" | "started" | "completed" | "canceled" };
  priority?: number; // 0=urgent, 1=high, 2=medium, 3=low, 4=no priority
  team?: { id: string; name: string; key: string };
  project?: { id: string; name: string } | null;
  cycle?: { id: string; name: string; number: number } | null;
  labels?: { nodes: Array<{ id: string; name: string }> };
  assignee?: { name: string } | null;
  createdAt?: string;
  updatedAt?: string;
  url: string;
}

/** Maps Linear priority (0-4) to StateHub priority. */
function mapPriority(p: number | undefined): "urgent" | "high" | "medium" | "low" {
  switch (p) {
    case 0:
      return "urgent";
    case 1:
      return "high";
    case 3:
      return "low";
    case 2:
    case 4:
    default:
      return "medium";
  }
}

async function findLinkedWorkItemId(
  db: DbClient,
  workspaceId: string,
  issueId: string,
): Promise<string | null> {
  const row = await db.first<{ entity_id: string }>(
    `SELECT entity_id FROM external_links
     WHERE workspace_id = ? AND entity_type = ? AND external_source = ? AND external_id = ?
     LIMIT 1`,
    [workspaceId, "work_item", "linear", issueId],
  );
  return row?.entity_id ?? null;
}

function buildDescription(issue: LinearIssue): string {
  const parts: string[] = [];
  if (issue.description?.trim()) {
    parts.push(issue.description.trim().slice(0, 400));
  }
  const labelNames = issue.labels?.nodes?.map((n) => n.name) ?? [];
  if (labelNames.length) {
    parts.push(`labels: ${labelNames.join(", ")}`);
  }
  if (issue.assignee?.name) {
    parts.push(`(assigned: @${issue.assignee.name})`);
  }
  return parts.join("\n\n").slice(0, 500);
}

async function resolveProjectFeature(
  db: DbClient,
  workspaceId: string,
  projectId: string,
  projectName: string | null | undefined,
): Promise<{ id: string; name: string } | null> {
  if (!projectName?.trim()) return null;
  const features = await featureService.list(db, workspaceId, projectId);
  const match = features.find(
    (f) => f.name.toLowerCase() === projectName.trim().toLowerCase(),
  );
  return match ? { id: match.id, name: match.name } : null;
}

async function validateTarget(
  db: DbClient,
  workspaceId: string,
  input: { projectId?: string; stateId?: string },
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

export interface LinearIssuesImporter {
  preview(
    db: DbClient,
    workspaceId: string,
    integrationId: string,
    input: LinearImportInput,
  ): Promise<ImportPreview>;
  run(
    db: DbClient,
    actor: ActorContext,
    workspaceId: string,
    integrationId: string,
    input: LinearImportInput,
  ): Promise<ImportRunResult>;
}

export const linearIssuesImporter: LinearIssuesImporter = {
  async preview(db, workspaceId, _integrationId, input) {
    await validateTarget(db, workspaceId, input);

    const toCreate: ImportPreviewItem[] = [];
    const toSkip: ImportSkipItem[] = [];
    const errors: ImportErrorItem[] = [];

    for (const issue of input.issues) {
      if (!issue.identifier?.trim()) {
        errors.push({
          issueNumber: 0,
          message: `issue ${issue.id ?? "(no id)"} has no identifier`,
        });
        continue;
      }
      if (!issue.url?.trim()) {
        errors.push({
          issueNumber: 0,
          message: `issue ${issue.identifier} has no url`,
        });
        continue;
      }
      if (!issue.title?.trim()) {
        errors.push({
          issueNumber: 0,
          message: `issue ${issue.identifier} has no title`,
        });
        continue;
      }

      const existing = await findLinkedWorkItemId(db, workspaceId, issue.id);
      if (existing) {
        toSkip.push({
          issueNumber: 0,
          issueTitle: issue.identifier,
          existingWorkItemId: existing,
        });
        continue;
      }

      const feature = await resolveProjectFeature(
        db,
        workspaceId,
        input.projectId,
        issue.project?.name,
      );
      toCreate.push({
        issueNumber: 0,
        issueTitle: issue.identifier,
        issueUrl: issue.url,
        workItemTitle: `${issue.identifier}: ${issue.title}`,
        workItemDescription: buildDescription(issue),
        featureId: feature?.id ?? null,
        featureName: feature?.name ?? null,
      });
    }

    return { toCreate, toSkip, errors };
  },

  async run(db, actor, workspaceId, integrationId, input) {
    const previewResult = await linearIssuesImporter.preview(
      db,
      workspaceId,
      integrationId,
      input,
    );

    const jobId = crypto.randomUUID();
    const startedAt = Date.now();
    const inputJson = JSON.stringify({
      projectId: input.projectId,
      stateId: input.stateId,
      issueCount: input.issues.length,
      issueIds: input.issues.map((i) => i.id),
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
        "linear",
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
            provider: "linear",
            issueCount: input.issues.length,
          },
        },
      },
      () => [],
    );

    const created: ImportRunItem[] = [];
    const skipped = previewResult.toSkip;
    const errors = [...previewResult.errors];

    // Build a title → issue lookup so run can recover the source issue
    // for each toCreate item without re-parsing. Titles are unique within
    // a Linear team (identifier is unique), so this is safe for v1.
    const issuesByTitle = new Map<string, LinearIssue>();
    for (const issue of input.issues) {
      if (issue.identifier && issue.title) {
        issuesByTitle.set(`${issue.identifier}: ${issue.title}`, issue);
      }
    }

    for (const item of previewResult.toCreate) {
      try {
        const issue = issuesByTitle.get(item.workItemTitle);
        if (!issue) {
          throw new Error(`could not recover source issue for "${item.workItemTitle}"`);
        }
        const wi = await workItemService.create(db, actor, workspaceId, input.projectId, {
          title: item.workItemTitle,
          descriptionMarkdown: item.workItemDescription,
          type: "issue",
          priority: mapPriority(issue.priority),
          stateId: input.stateId,
          featureId: item.featureId ?? undefined,
          source: "import",
        });

        await externalLinkService.create(db, actor, workspaceId, {
          projectId: input.projectId,
          entityType: "work_item",
          entityId: wi.id,
          externalSource: "linear",
          externalId: issue.id,
          externalUrl: issue.url,
        });

        created.push({ issueNumber: 0, workItemId: wi.id });
      } catch (err) {
        errors.push({
          issueNumber: 0,
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

    await db.run(
      `UPDATE import_jobs SET status = ?, summary_json = ?, result_json = ?, finished_at = ? WHERE id = ?`,
      ["completed", summaryJson, resultJson, finishedAt, jobId],
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
            status: "completed",
            summary: { created: created.length, skipped: skipped.length, errors: errors.length },
          },
        },
      },
      () => [],
    );

    return { jobId, created, skipped, errors };
  },
};

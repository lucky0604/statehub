/**
 * Plane issues importer — map Plane issues to StateHub work items.
 *
 * Source: agent_flow/implementation/v1/phases/phase-06-import-integration.md
 *         §5.1 (Plane mapping), §3 principle 5 (imports are idempotent)
 *
 * Same idempotency + conflict semantics as githubIssuesImporter (P06B):
 *   - Idempotency: check external_links for an existing
 *     (workspace_id, entity_type="work_item", external_source="plane",
 *     external_id=issue.id) row. If found, skip.
 *   - Conflict: "skip if already linked" — v1 rule.
 *
 * The importer is pure — takes a list of PlaneIssue objects (the UI
 * is responsible for fetching them via the Plane API or accepting a
 * JSON paste) and returns a preview or runs the import. No I/O
 * against Plane from this service.
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

/** Input for a Plane import — same shape as ImportInput but with Plane issues. */
export interface PlaneImportInput {
  projectId: string;
  stateId: string;
  issues: PlaneIssue[];
}

/** Subset of the Plane API issue shape — enough to map. */
export interface PlaneIssue {
  id: string;
  name: string; // "ABC-123" identifier
  description?: string | null;
  state?: string; // state name
  state_group?: "backlog" | "unstarted" | "started" | "completed" | "cancelled";
  priority?: "urgent" | "high" | "medium" | "low" | "none";
  project?: string; // project name
  cycle?: { id: string; name: string } | null;
  labels?: string[];
  assignees?: string[];
  created_by?: string;
  created_at?: string;
  updated_at?: string;
  link: string; // web URL
}

/** Maps Plane priority to StateHub priority. */
function mapPriority(p: PlaneIssue["priority"]): "urgent" | "high" | "medium" | "low" {
  switch (p) {
    case "urgent":
      return "urgent";
    case "high":
      return "high";
    case "low":
      return "low";
    case "medium":
    case "none":
    default:
      return "medium";
  }
}

/**
 * Find an existing external_link for a plane issue by UUID.
 * Returns the linked work_item id, or null if not linked.
 */
async function findLinkedWorkItemId(
  db: DbClient,
  workspaceId: string,
  issueId: string,
): Promise<string | null> {
  const row = await db.first<{ entity_id: string }>(
    `SELECT entity_id FROM external_links
     WHERE workspace_id = ? AND entity_type = ? AND external_source = ? AND external_id = ?
     LIMIT 1`,
    [workspaceId, "work_item", "plane", issueId],
  );
  return row?.entity_id ?? null;
}

/**
 * Build a description string from the issue body + labels + assignees.
 * Caps at 500 chars to keep work item descriptions readable.
 */
function buildDescription(issue: PlaneIssue): string {
  const parts: string[] = [];
  if (issue.description?.trim()) {
    parts.push(issue.description.trim().slice(0, 400));
  }
  if (issue.labels?.length) {
    parts.push(`labels: ${issue.labels.join(", ")}`);
  }
  if (issue.assignees?.length) {
    parts.push(`(assigned: ${issue.assignees.map((a) => `@${a}`).join(", ")})`);
  }
  return parts.join("\n\n").slice(0, 500);
}

/**
 * Resolve a Plane project name to an existing feature by name
 * (case-insensitive). Returns null if no match — we don't auto-create
 * features in v1. (Plane "project" maps to StateHub "feature" when the
 * user is importing into a single StateHub project.)
 */
async function resolveProjectFeature(
  db: DbClient,
  workspaceId: string,
  projectId: string,
  projectName: string | undefined,
): Promise<{ id: string; name: string } | null> {
  if (!projectName?.trim()) return null;
  const features = await featureService.list(db, workspaceId, projectId);
  const match = features.find(
    (f) => f.name.toLowerCase() === projectName.trim().toLowerCase(),
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

export interface PlaneIssuesImporter {
  preview(
    db: DbClient,
    workspaceId: string,
    integrationId: string,
    input: PlaneImportInput,
  ): Promise<ImportPreview>;
  run(
    db: DbClient,
    actor: ActorContext,
    workspaceId: string,
    integrationId: string,
    input: PlaneImportInput,
  ): Promise<ImportRunResult>;
}

export const planeIssuesImporter: PlaneIssuesImporter = {
  async preview(db, workspaceId, _integrationId, input) {
    await validateTarget(db, workspaceId, input);

    const toCreate: ImportPreviewItem[] = [];
    const toSkip: ImportSkipItem[] = [];
    const errors: ImportErrorItem[] = [];

    for (const issue of input.issues) {
      if (!issue.name?.trim()) {
        errors.push({
          issueNumber: 0, // Plane has no number — use 0 as placeholder
          message: `issue ${issue.id ?? "(no id)"} has no name`,
        });
        continue;
      }
      if (!issue.link?.trim()) {
        errors.push({
          issueNumber: 0,
          message: `issue ${issue.name} has no link`,
        });
        continue;
      }

      const existing = await findLinkedWorkItemId(db, workspaceId, issue.id);
      if (existing) {
        toSkip.push({
          issueNumber: 0,
          issueTitle: issue.name,
          existingWorkItemId: existing,
        });
        continue;
      }

      const feature = await resolveProjectFeature(
        db,
        workspaceId,
        input.projectId,
        issue.project,
      );
      toCreate.push({
        issueNumber: 0,
        issueTitle: issue.name,
        issueUrl: issue.link,
        workItemTitle: issue.name,
        workItemDescription: buildDescription(issue),
        featureId: feature?.id ?? null,
        featureName: feature?.name ?? null,
      });
    }

    return { toCreate, toSkip, errors };
  },

  async run(db, actor, workspaceId, integrationId, input) {
    const previewResult = await planeIssuesImporter.preview(
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
        "plane",
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
            provider: "plane",
            issueCount: input.issues.length,
          },
        },
      },
      () => [],
    );

    const created: ImportRunItem[] = [];
    const skipped = previewResult.toSkip;
    const errors = [...previewResult.errors];

    for (const item of previewResult.toCreate) {
      try {
        const issue = input.issues.find((i) => i.name === item.issueTitle);
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
          externalSource: "plane",
          externalId: issue.id,
          externalUrl: issue.link,
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

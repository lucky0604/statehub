/**
 * Review service — structured agent reviews + findings.
 *
 * Source: agent_flow/implementation/v1/phases/phase-03-review-ledger-loop.md §3, §4, §6
 *         agent_flow/implementation/v1/iterations/20260716-p03a-review-ledger-foundation/plan.md
 *
 * A review is what an agent (Codex/GPT/Gemini) returns when asked to review
 * a feature / work item / agent run. submit creates the review + its findings
 * in one transaction; transitionFinding moves a finding through the §6 state
 * machine; dismissFinding is a typed alias that enforces the reason requirement;
 * createFollowupFixes walks blocker/high findings and creates one review_fix
 * work item per finding, linked back via linked_work_item_id.
 *
 * P03A records reviews + findings but does NOT drive feature status automation
 * — that ships in P03B alongside the review-aware Done Gate v1.
 */
import {
  type DbClient,
  type ActorContext,
  type Review,
  type ReviewFinding,
  type ReviewVerdict,
  type FindingSeverity,
  type FindingStatus,
  type ConfidenceLevel,
  type SqlBindValue,
  type SqlStmt,
  buildEventStmt,
} from "@statehub/db";
import { mapReview, mapReviewFinding } from "../mappers";
import { workItemService } from "./work-item";
import { featureService } from "./feature";
import { NotFoundError, ValidationError } from "../errors";

export interface ReviewFindingInput {
  severity: FindingSeverity;
  title: string;
  description?: string;
  filePath?: string;
  lineStart?: number;
  lineEnd?: number;
  suggestion?: string;
  featureId?: string;
  workItemId?: string;
}

export interface SubmitReviewInput {
  projectId: string;
  featureId?: string;
  workItemId?: string;
  agentRunId?: string;
  reviewer: string;
  model?: string;
  verdict: ReviewVerdict;
  summary?: string;
  confidence?: ConfidenceLevel;
  findings: ReviewFindingInput[];
}

export interface SubmitReviewResult {
  review: Review;
  findings: ReviewFinding[];
}

export interface TransitionFindingInput {
  toStatus: FindingStatus;
  dismissedReason?: string;
}

export interface CreateFollowupFixesInput {
  reviewId: string;
  severities?: FindingSeverity[];
}

export interface CreatedFix {
  workItemId: string;
  sequenceId: number;
  identifier: string;
  findingId: string;
  severity: FindingSeverity;
}

export interface SkippedFinding {
  findingId: string;
  severity: FindingSeverity;
  reason: "already_linked" | "severity_filtered";
}

export interface CreateFollowupFixesResult {
  createdFixes: CreatedFix[];
  skippedFindings: SkippedFinding[];
  action: "created" | "noop";
}

export interface ListReviewsFilter {
  projectId?: string;
  featureId?: string;
  workItemId?: string;
  agentRunId?: string;
  verdict?: ReviewVerdict;
  limit?: number;
}

/**
 * Allowed finding status transitions (phase-03 §6).
 * Keys are from_status; values are the set of allowed to_status values.
 */
const ALLOWED_TRANSITIONS: Record<FindingStatus, FindingStatus[]> = {
  open: ["accepted", "dismissed"],
  accepted: ["fixed"],
  fixed: ["reopened"],
  dismissed: ["reopened"],
  wontfix: [],
  reopened: ["accepted", "dismissed"],
};

const SEVERITY_RANK: Record<FindingSeverity, number> = {
  blocker: 0,
  high: 1,
  medium: 2,
  low: 3,
  nit: 4,
};

const DEFAULT_FOLLOWUP_SEVERITIES: FindingSeverity[] = ["blocker", "high"];

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

async function lookupFeature(
  db: DbClient,
  workspaceId: string,
  projectId: string,
  featureId: string,
): Promise<void> {
  const row = await db.first<{ id: string }>(
    "SELECT id FROM features WHERE id = ? AND workspace_id = ? AND project_id = ? AND deleted_at IS NULL",
    [featureId, workspaceId, projectId],
  );
  if (!row) throw new NotFoundError("feature", featureId);
}

async function lookupWorkItem(
  db: DbClient,
  workspaceId: string,
  projectId: string,
  workItemId: string,
): Promise<void> {
  const row = await db.first<{ id: string }>(
    "SELECT id FROM work_items WHERE id = ? AND workspace_id = ? AND project_id = ? AND deleted_at IS NULL",
    [workItemId, workspaceId, projectId],
  );
  if (!row) throw new NotFoundError("work_item", workItemId);
}

async function lookupAgentRun(
  db: DbClient,
  workspaceId: string,
  projectId: string,
  agentRunId: string,
): Promise<void> {
  const row = await db.first<{ id: string }>(
    "SELECT id FROM agent_runs WHERE id = ? AND workspace_id = ? AND project_id = ? AND deleted_at IS NULL",
    [agentRunId, workspaceId, projectId],
  );
  if (!row) throw new NotFoundError("agent_run", agentRunId);
}

export interface ReviewService {
  submit(
    db: DbClient,
    actor: ActorContext,
    workspaceId: string,
    input: SubmitReviewInput,
  ): Promise<SubmitReviewResult>;
  get(db: DbClient, workspaceId: string, reviewId: string): Promise<Review | null>;
  listFindings(
    db: DbClient,
    workspaceId: string,
    reviewId: string,
  ): Promise<ReviewFinding[]>;
  listForFeature(
    db: DbClient,
    workspaceId: string,
    featureId: string,
    limit?: number,
  ): Promise<Review[]>;
  listForProject(
    db: DbClient,
    workspaceId: string,
    projectId: string,
    limit?: number,
  ): Promise<Review[]>;
  list(
    db: DbClient,
    workspaceId: string,
    filter: ListReviewsFilter,
  ): Promise<Review[]>;
  transitionFinding(
    db: DbClient,
    actor: ActorContext,
    workspaceId: string,
    findingId: string,
    input: TransitionFindingInput,
  ): Promise<ReviewFinding>;
  dismissFinding(
    db: DbClient,
    actor: ActorContext,
    workspaceId: string,
    findingId: string,
    reason: string,
  ): Promise<ReviewFinding>;
  createFollowupFixes(
    db: DbClient,
    actor: ActorContext,
    workspaceId: string,
    input: CreateFollowupFixesInput,
  ): Promise<CreateFollowupFixesResult>;
}

export const reviewService: ReviewService = {
  async submit(db, actor, workspaceId, input) {
    if (!input.reviewer?.trim()) throw new ValidationError("reviewer is required");
    if (!input.verdict) throw new ValidationError("verdict is required");
    await lookupProject(db, workspaceId, input.projectId);

    if (input.featureId) await lookupFeature(db, workspaceId, input.projectId, input.featureId);
    if (input.workItemId) await lookupWorkItem(db, workspaceId, input.projectId, input.workItemId);
    if (input.agentRunId) await lookupAgentRun(db, workspaceId, input.projectId, input.agentRunId);

    // Validate findings up front so we don't half-write a review.
    for (const f of input.findings) {
      if (!f.severity) throw new ValidationError("finding.severity is required");
      if (!f.title?.trim()) throw new ValidationError("finding.title is required");
      if (f.featureId) await lookupFeature(db, workspaceId, input.projectId, f.featureId);
      if (f.workItemId) await lookupWorkItem(db, workspaceId, input.projectId, f.workItemId);
    }

    const reviewId = crypto.randomUUID();
    const reviewParams: SqlBindValue[] = [
      reviewId,
      workspaceId,
      input.projectId,
      input.featureId ?? null,
      input.workItemId ?? null,
      input.agentRunId ?? null,
      input.reviewer,
      input.model ?? null,
      input.verdict,
      input.summary ?? null,
      input.confidence ?? "none",
      1,
      actor.id ?? null,
      actor.id ?? null,
    ];

    // Build finding INSERT statements — one per finding. Each finding also
    // gets its own finding.created event. We batch the review insert + the
    // review.submitted event + all finding inserts + all finding.created
    // events in one atomic batch.
    const findingIds: string[] = [];
    const findingStmts: SqlStmt[] = [];
    const findingEventStmts: SqlStmt[] = [];

    // We need to build events manually here (rather than via withEvent) so
    // we can batch everything atomically. buildEventStmt is exported from
    // @statehub/db for exactly this case.
    const reviewEventStmt = buildEventStmt({
      workspaceId,
      projectId: input.projectId,
      featureId: input.featureId,
      workItemId: input.workItemId,
      entityType: "review",
      entityId: reviewId,
      eventType: "review.submitted",
      actor,
      source: actor.type,
      payload: {
        reviewId,
        verdict: input.verdict,
        findingsCount: input.findings.length,
        target: {
          featureId: input.featureId ?? null,
          workItemId: input.workItemId ?? null,
          agentRunId: input.agentRunId ?? null,
        },
      },
    });

    for (const f of input.findings) {
      const findingId = crypto.randomUUID();
      findingIds.push(findingId);
      const featureId = f.featureId ?? input.featureId ?? null;
      const workItemId = f.workItemId ?? input.workItemId ?? null;

      findingStmts.push({
        sql: `INSERT INTO review_findings (
          id, workspace_id, review_id, project_id, feature_id, work_item_id,
          severity, title, description, file_path, line_start, line_end, suggestion,
          status, version, created_by, updated_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', 1, ?, ?)`,
        params: [
          findingId,
          workspaceId,
          reviewId,
          input.projectId,
          featureId,
          workItemId,
          f.severity,
          f.title,
          f.description ?? null,
          f.filePath ?? null,
          f.lineStart ?? null,
          f.lineEnd ?? null,
          f.suggestion ?? null,
          actor.id ?? null,
          actor.id ?? null,
        ],
      });

      findingEventStmts.push(
        buildEventStmt({
          workspaceId,
          projectId: input.projectId,
          featureId: featureId ?? undefined,
          workItemId: workItemId ?? undefined,
          entityType: "finding",
          entityId: findingId,
          eventType: "finding.created",
          actor,
          source: actor.type,
          payload: {
            findingId,
            reviewId,
            severity: f.severity,
            title: f.title,
            status: "open",
          },
        }),
      );
    }

    const reviewInsertStmt: SqlStmt = {
      sql: `INSERT INTO reviews (
        id, workspace_id, project_id, feature_id, work_item_id, agent_run_id,
        reviewer, model, verdict, summary, confidence, version, created_by, updated_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: reviewParams,
    };

    // One atomic batch: review insert + review.submitted event + N finding
    // inserts + N finding.created events. Either everything commits or
    // nothing does.
    const allStmts: SqlStmt[] = [reviewInsertStmt, reviewEventStmt];
    for (let i = 0; i < findingStmts.length; i++) {
      const ev = findingEventStmts[i];
      const ins = findingStmts[i];
      if (ev) allStmts.push(ev);
      if (ins) allStmts.push(ins);
    }
    await db.batch(allStmts);

    const reviewRow = await db.first<Record<string, unknown>>(
      "SELECT * FROM reviews WHERE id = ?",
      [reviewId],
    );
    if (!reviewRow) throw new Error("review insert failed");
    const review = mapReview(reviewRow);

    const findingRows = await db.all<Record<string, unknown>>(
      "SELECT * FROM review_findings WHERE review_id = ? ORDER BY created_at ASC",
      [reviewId],
    );
    const findings = findingRows.map(mapReviewFinding);

    // P03B: feature status automation. If the review targets a feature,
    // verdict is 'needs_changes', and there is at least one open blocker/high
    // finding, move the feature to 'needs_changes'. Idempotent — if the
    // feature is already needs_changes (or done), no event is emitted.
    // phase-03 §6: "review verdict = needs_changes + blocker/high > 0 -> feature needs_changes"
    if (input.featureId && input.verdict === "needs_changes") {
      const hasOpenBlockerHigh = findings.some(
        (f) => f.severity === "blocker" || f.severity === "high",
      );
      if (hasOpenBlockerHigh) {
        const feature = await featureService.get(db, workspaceId, input.featureId);
        if (feature && feature.status !== "needs_changes" && feature.status !== "done" && feature.status !== "reopened") {
          try {
            await featureService.changeStatus(db, actor, workspaceId, input.featureId, "needs_changes");
          } catch {
            // If the transition is not allowed (e.g. feature is 'backlog'),
            // skip the automation — the review is still recorded.
          }
        }
      }
    }

    return { review, findings };
  },

  async get(db, workspaceId, reviewId) {
    const row = await db.first<Record<string, unknown>>(
      "SELECT * FROM reviews WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL",
      [reviewId, workspaceId],
    );
    return row ? mapReview(row) : null;
  },

  async listFindings(db, workspaceId, reviewId) {
    const rows = await db.all<Record<string, unknown>>(
      "SELECT * FROM review_findings WHERE workspace_id = ? AND review_id = ? AND deleted_at IS NULL ORDER BY created_at ASC",
      [workspaceId, reviewId],
    );
    return rows.map(mapReviewFinding);
  },

  async listForFeature(db, workspaceId, featureId, limit = 20) {
    const cap = Math.min(limit, 100);
    const rows = await db.all<Record<string, unknown>>(
      "SELECT * FROM reviews WHERE workspace_id = ? AND feature_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ?",
      [workspaceId, featureId, cap],
    );
    return rows.map(mapReview);
  },

  async listForProject(db, workspaceId, projectId, limit = 20) {
    const cap = Math.min(limit, 100);
    const rows = await db.all<Record<string, unknown>>(
      "SELECT * FROM reviews WHERE workspace_id = ? AND project_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT ?",
      [workspaceId, projectId, cap],
    );
    return rows.map(mapReview);
  },

  async list(db, workspaceId, filter) {
    const cap = Math.min(filter.limit ?? 50, 100);
    const where: string[] = ["workspace_id = ?", "deleted_at IS NULL"];
    const params: SqlBindValue[] = [workspaceId];
    if (filter.projectId) {
      where.push("project_id = ?");
      params.push(filter.projectId);
    }
    if (filter.featureId) {
      where.push("feature_id = ?");
      params.push(filter.featureId);
    }
    if (filter.workItemId) {
      where.push("work_item_id = ?");
      params.push(filter.workItemId);
    }
    if (filter.agentRunId) {
      where.push("agent_run_id = ?");
      params.push(filter.agentRunId);
    }
    if (filter.verdict) {
      where.push("verdict = ?");
      params.push(filter.verdict);
    }
    params.push(cap);
    const rows = await db.all<Record<string, unknown>>(
      `SELECT * FROM reviews WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT ?`,
      params,
    );
    return rows.map(mapReview);
  },

  async transitionFinding(db, actor, workspaceId, findingId, input) {
    const existing = await db.first<Record<string, unknown>>(
      "SELECT * FROM review_findings WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL",
      [findingId, workspaceId],
    );
    if (!existing) throw new NotFoundError("finding", findingId);
    const fromStatus = existing.status as FindingStatus;

    const allowed = ALLOWED_TRANSITIONS[fromStatus] ?? [];
    if (!allowed.includes(input.toStatus)) {
      throw new ValidationError(
        `finding ${findingId} cannot transition from ${fromStatus} to ${input.toStatus}`,
      );
    }

    // Dismiss requires a reason (phase-03 §6 "Dismiss requires").
    if (input.toStatus === "dismissed" && !input.dismissedReason?.trim()) {
      throw new ValidationError("dismissed_reason is required to dismiss a finding");
    }

    const updateSql = `UPDATE review_findings SET
      status = ?,
      dismissed_reason = ?,
      dismissed_by = ?,
      dismissed_at = ?,
      updated_at = unixepoch() * 1000,
      version = version + 1,
      updated_by = ?
      WHERE id = ? AND workspace_id = ? AND version = ?`;

    const dismissedAt =
      input.toStatus === "dismissed" ? Date.now() : (existing.dismissed_at as number | null) ?? null;
    const dismissedBy =
      input.toStatus === "dismissed" ? actor.id ?? null : (existing.dismissed_by as string | null) ?? null;
    const dismissedReason =
      input.toStatus === "dismissed"
        ? input.dismissedReason ?? null
        : (existing.dismissed_reason as string | null) ?? null;

    const updateParams: SqlBindValue[] = [
      input.toStatus,
      dismissedReason,
      dismissedBy,
      dismissedAt,
      actor.id ?? null,
      findingId,
      workspaceId,
      existing.version as number,
    ];

    const eventStmt = buildEventStmt({
      workspaceId,
      projectId: existing.project_id as string,
      featureId: (existing.feature_id as string | null) ?? undefined,
      workItemId: (existing.work_item_id as string | null) ?? undefined,
      entityType: "finding",
      entityId: findingId,
      eventType: "finding.status_changed",
      actor,
      source: actor.type,
      payload: {
        findingId,
        fromStatus,
        toStatus: input.toStatus,
        reason: input.dismissedReason ?? null,
      },
    });

    await db.batch([eventStmt, { sql: updateSql, params: updateParams }]);

    const row = await db.first<Record<string, unknown>>(
      "SELECT * FROM review_findings WHERE id = ?",
      [findingId],
    );
    if (!row) throw new Error("finding transition failed");
    return mapReviewFinding(row);
  },

  async dismissFinding(db, actor, workspaceId, findingId, reason) {
    if (!reason?.trim()) {
      throw new ValidationError("dismissed_reason is required to dismiss a finding");
    }
    return reviewService.transitionFinding(db, actor, workspaceId, findingId, {
      toStatus: "dismissed",
      dismissedReason: reason,
    });
  },

  async createFollowupFixes(db, actor, workspaceId, input) {
    const review = await reviewService.get(db, workspaceId, input.reviewId);
    if (!review) throw new NotFoundError("review", input.reviewId);

    const severities = input.severities ?? DEFAULT_FOLLOWUP_SEVERITIES;
    // phase-03 §10 risk 2: do not silently allow low/nit scope pollution.
    for (const s of severities) {
      if (s === "low" || s === "nit") {
        throw new ValidationError(
          `auto-creating fix items for severity '${s}' is not allowed (would pollute project scope)`,
        );
      }
    }

    const allFindings = await reviewService.listFindings(db, workspaceId, input.reviewId);
    const createdFixes: CreatedFix[] = [];
    const skippedFindings: SkippedFinding[] = [];

    for (const f of allFindings) {
      if (!severities.includes(f.severity)) {
        skippedFindings.push({
          findingId: f.id,
          severity: f.severity,
          reason: "severity_filtered",
        });
        continue;
      }
      if (f.linkedWorkItemId) {
        skippedFindings.push({
          findingId: f.id,
          severity: f.severity,
          reason: "already_linked",
        });
        continue;
      }
      // Only open/accepted/reopened findings are eligible for fix creation.
      // fixed/dismissed/wontfix findings have already been resolved.
      if (f.status === "fixed" || f.status === "dismissed" || f.status === "wontfix") {
        skippedFindings.push({
          findingId: f.id,
          severity: f.severity,
          reason: "already_linked",
        });
        continue;
      }

      // Create the review_fix work item via workItemService.upsert. The
      // fingerprint is (workspace, project, parent=null, lower(title)).
      // Title is `[review_fix] ${finding.title}` so it's visible in lists.
      // We pass featureId so the fix item is scoped to the same feature as
      // the finding (if any).
      const fixTitle = `[review_fix] ${f.title}`;
      const upsertRes = await workItemService.upsert(db, actor, workspaceId, review.projectId, {
        title: fixTitle,
        descriptionMarkdown: f.description ?? undefined,
        featureId: f.featureId ?? review.featureId ?? undefined,
        type: "task",
        priority: severityToPriority(f.severity),
        source: actor.type === "user" ? "user" : actor.type,
        confidence: "low",
      });

      // Link the finding to the work item. We update finding.linked_work_item_id
      // and emit finding.linked in one batch.
      const linkEvent = buildEventStmt({
        workspaceId,
        projectId: review.projectId,
        featureId: f.featureId ?? review.featureId ?? undefined,
        entityType: "finding",
        entityId: f.id,
        eventType: "finding.linked",
        actor,
        source: actor.type,
        payload: {
          findingId: f.id,
          workItemId: upsertRes.workItem.id,
          workItemIdentifier: `${upsertRes.workItem.projectIdentifier}-${upsertRes.workItem.sequenceId}`,
        },
      });
      const linkUpdate: SqlStmt = {
        sql: `UPDATE review_findings SET
          linked_work_item_id = ?,
          updated_at = unixepoch() * 1000,
          version = version + 1,
          updated_by = ?
          WHERE id = ? AND workspace_id = ?`,
        params: [
          upsertRes.workItem.id,
          actor.id ?? null,
          f.id,
          workspaceId,
        ] as SqlBindValue[],
      };
      await db.batch([linkEvent, linkUpdate]);

      createdFixes.push({
        workItemId: upsertRes.workItem.id,
        sequenceId: upsertRes.workItem.sequenceId,
        identifier: `${upsertRes.workItem.projectIdentifier}-${upsertRes.workItem.sequenceId}`,
        findingId: f.id,
        severity: f.severity,
      });
    }

    return {
      createdFixes: createdFixingsBySeverity(createdFixes, allFindings),
      skippedFindings,
      action: createdFixes.length > 0 ? "created" : "noop",
    };
  },
};

/** Sort created fixes by severity (blocker first) for deterministic output. */
function createdFixingsBySeverity(
  fixes: CreatedFix[],
  findings: ReviewFinding[],
): CreatedFix[] {
  const byFinding = new Map(findings.map((f) => [f.id, f]));
  return [...fixes].sort((a, b) => {
    const sa = byFinding.get(a.findingId)?.severity ?? "medium";
    const sb = byFinding.get(b.findingId)?.severity ?? "medium";
    return SEVERITY_RANK[sa] - SEVERITY_RANK[sb];
  });
}

/** Map finding severity to work-item priority for the generated fix item. */
function severityToPriority(s: FindingSeverity): "urgent" | "high" | "medium" | "low" | "none" {
  switch (s) {
    case "blocker":
      return "urgent";
    case "high":
      return "high";
    case "medium":
      return "medium";
    case "low":
      return "low";
    case "nit":
      return "none";
  }
}

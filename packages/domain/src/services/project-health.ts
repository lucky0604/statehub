/**
 * Project health service — deterministic, derived health summaries.
 *
 * Source: agent_flow/implementation/v1/phases/phase-01-plane-like-core-project-health-summary.md §4.7
 *         agent_flow/prd/v1.md §8.1, §8.2
 *         agent_flow/implementation/v1/03-data-contracts-and-db-invariants.md §9 (trust principle)
 *
 * No provider/LLM. Every signal is computed from work_items + features + states,
 * and every signal carries a reason so the user knows WHY a project is flagged.
 *
 * UI copy is "Project Health", never "AI PM" (reserved for P05).
 */
import type { DbClient, WorkItem, Feature, State, Priority } from "@statehub/db";

/** A work item in a project, plus its resolved state name + label ids. */
interface ItemWithMeta {
  workItem: WorkItem;
  stateName: string | null;
  labelIds: string[];
}

export interface HealthFocus {
  workItemId: string;
  title: string;
  identifier: string;
}

export interface HealthNextAction {
  workItemId: string;
  title: string;
  identifier: string;
  reason: string;
}

export interface ProjectHealthSummary {
  projectId: string;
  openCount: number;
  startedCount: number;
  unstartedCount: number;
  backlogCount: number;
  currentFocus: HealthFocus | null;
  /** First feature in 'in_progress' status, for the portfolio "Current Feature" column. */
  currentFeature: { id: string; name: string } | null;
  nextAction: HealthNextAction | null;
  staleCount: number;
  blockedCount: number;
  missingNextAction: boolean;
  suggestedNextStep: string;
  lastActivityAt: number | null;
}

export interface AtRiskProject {
  projectId: string;
  projectName: string;
  reasons: string[];
}

export interface PortfolioHealth {
  byProject: ProjectHealthSummary[];
  atRisk: AtRiskProject[];
  openHigh: number;
}

const PRIORITY_RANK: Record<Priority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
};

/** A started item is "stale" if not updated in this many days. */
const STALE_DAYS = 7;
const STALE_MS = STALE_DAYS * 24 * 60 * 60 * 1000;

/** Portfolio priority ordering for sorting the portfolio table. */
export const PORTFOLIO_PRIORITY_RANK: Record<string, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  Parked: 3,
};

export interface ProjectHealthService {
  summarize(
    db: DbClient,
    workspaceId: string,
    projectId: string,
    options?: SummarizeOptions,
  ): Promise<ProjectHealthSummary>;
  portfolio(db: DbClient, workspaceId: string): Promise<PortfolioHealth>;
}

/** `now` is injected so tests are deterministic. Defaults to Date.now(). */
export interface SummarizeOptions {
  now?: number;
}

async function loadItemsWithMeta(
  db: DbClient,
  workspaceId: string,
  projectId: string,
): Promise<{ items: ItemWithMeta[]; features: Feature[]; states: State[] }> {
  const wiRows = await db.all<Record<string, unknown>>(
    "SELECT * FROM work_items WHERE workspace_id = ? AND project_id = ? AND deleted_at IS NULL",
    [workspaceId, projectId],
  );
  const stateRows = await db.all<Record<string, unknown>>(
    "SELECT * FROM states WHERE workspace_id = ? AND project_id = ? AND deleted_at IS NULL",
    [workspaceId, projectId],
  );
  const featureRows = await db.all<Record<string, unknown>>(
    "SELECT * FROM features WHERE workspace_id = ? AND project_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC, created_at ASC",
    [workspaceId, projectId],
  );
  const labelRows = await db.all<{ work_item_id: string; label_id: string }>(
    "SELECT work_item_id, label_id FROM work_item_labels WHERE work_item_id IN (SELECT id FROM work_items WHERE workspace_id = ? AND project_id = ?)",
    [workspaceId, projectId],
  );
  const labelByItem = new Map<string, string[]>();
  for (const r of labelRows) {
    const arr = labelByItem.get(r.work_item_id) ?? [];
    arr.push(r.label_id);
    labelByItem.set(r.work_item_id, arr);
  }

  const stateById = new Map<string, State>();
  const states: State[] = [];
  for (const s of stateRows) {
    const st: State = {
      id: s.id as string,
      workspaceId: s.workspace_id as string,
      projectId: s.project_id as string,
      name: s.name as string,
      description: (s.description as string | null) ?? null,
      statusGroup: s.status_group as State["statusGroup"],
      color: (s.color as string | null) ?? null,
      sortOrder: s.sort_order as number,
      createdAt: s.created_at as number,
      updatedAt: s.updated_at as number,
      deletedAt: (s.deleted_at as number | null) ?? null,
      version: s.version as number,
      createdBy: (s.created_by as string | null) ?? null,
      updatedBy: (s.updated_by as string | null) ?? null,
    };
    stateById.set(st.id, st);
    states.push(st);
  }

  // Resolve label names for the blocked heuristic (review-fix).
  const labelNameRows = await db.all<{ id: string; name: string }>(
    "SELECT id, name FROM labels WHERE workspace_id = ? AND project_id = ? AND deleted_at IS NULL",
    [workspaceId, projectId],
  );
  const labelNameById = new Map<string, string>(labelNameRows.map((r) => [r.id, r.name]));

  const features: Feature[] = featureRows.map((f) => ({
    id: f.id as string,
    workspaceId: f.workspace_id as string,
    projectId: f.project_id as string,
    name: f.name as string,
    description: (f.description as string | null) ?? null,
    status: f.status as Feature["status"],
    sortOrder: f.sort_order as number,
    createdAt: f.created_at as number,
    updatedAt: f.updated_at as number,
    deletedAt: (f.deleted_at as number | null) ?? null,
    version: f.version as number,
    createdBy: (f.created_by as string | null) ?? null,
    updatedBy: (f.updated_by as string | null) ?? null,
  }));

  const items: ItemWithMeta[] = wiRows.map((r) => {
    const wi: WorkItem = {
      id: r.id as string,
      workspaceId: r.workspace_id as string,
      projectId: r.project_id as string,
      featureId: (r.feature_id as string | null) ?? null,
      parentWorkItemId: (r.parent_work_item_id as string | null) ?? null,
      sequenceId: r.sequence_id as number,
      projectIdentifier: r.project_identifier as string,
      title: r.title as string,
      descriptionMarkdown: (r.description_markdown as string | null) ?? null,
      stateId: (r.state_id as string | null) ?? null,
      statusGroup: r.status_group as WorkItem["statusGroup"],
      type: r.type as WorkItem["type"],
      priority: r.priority as WorkItem["priority"],
      source: r.source as WorkItem["source"],
      confidence: r.confidence as WorkItem["confidence"],
      startDate: (r.start_date as number | null) ?? null,
      targetDate: (r.target_date as number | null) ?? null,
      completedAt: (r.completed_at as number | null) ?? null,
      sortOrder: r.sort_order as number,
      createdAt: r.created_at as number,
      updatedAt: r.updated_at as number,
      deletedAt: (r.deleted_at as number | null) ?? null,
      version: r.version as number,
      createdBy: (r.created_by as string | null) ?? null,
      updatedBy: (r.updated_by as string | null) ?? null,
    };
    const state = wi.stateId ? stateById.get(wi.stateId) : undefined;
    return {
      workItem: wi,
      stateName: state?.name ?? null,
      labelIds: (labelByItem.get(wi.id) ?? []).filter((lid) => {
        const name = labelNameById.get(lid);
        return name ? name === "review-fix" : false;
      }),
    };
  });

  return { items, features, states };
}

function focusOf(items: ItemWithMeta[], features: Feature[]): HealthFocus | null {
  // 1. latest-updated started work item
  const started = items.filter((i) => i.workItem.statusGroup === "started");
  if (started.length > 0) {
    const top = started.reduce((a, b) =>
      a.workItem.updatedAt > b.workItem.updatedAt ? a : b,
    );
    return {
      workItemId: top.workItem.id,
      title: top.workItem.title,
      identifier: `${top.workItem.projectIdentifier}-${top.workItem.sequenceId}`,
    };
  }
  // 2. first in_progress feature
  const inProgress = features.find((f) => f.status === "in_progress");
  if (inProgress) {
    return { workItemId: inProgress.id, title: inProgress.name, identifier: inProgress.name };
  }
  return null;
}

function nextActionOf(items: ItemWithMeta[]): HealthNextAction | null {
  const queued = items.filter(
    (i) => i.workItem.statusGroup === "unstarted" || i.workItem.statusGroup === "backlog",
  );
  if (queued.length === 0) return null;
  queued.sort((a, b) => {
    const pr = PRIORITY_RANK[a.workItem.priority] - PRIORITY_RANK[b.workItem.priority];
    if (pr !== 0) return pr;
    return a.workItem.sequenceId - b.workItem.sequenceId; // oldest first
  });
  const top = queued[0]!;
  return {
    workItemId: top.workItem.id,
    title: top.workItem.title,
    identifier: `${top.workItem.projectIdentifier}-${top.workItem.sequenceId}`,
    reason: "Highest-priority unstarted work",
  };
}

function computeSummary(
  projectId: string,
  items: ItemWithMeta[],
  features: Feature[],
  now: number,
): ProjectHealthSummary {
  const open = items.filter(
    (i) => i.workItem.statusGroup !== "completed" && i.workItem.statusGroup !== "cancelled",
  );
  const started = items.filter((i) => i.workItem.statusGroup === "started");
  const unstarted = items.filter((i) => i.workItem.statusGroup === "unstarted");
  const backlog = items.filter((i) => i.workItem.statusGroup === "backlog");

  const staleCount = started.filter((i) => now - i.workItem.updatedAt > STALE_MS).length;
  const blockedCount = items.filter(
    (i) =>
      (i.stateName !== null && /review/i.test(i.stateName)) || i.labelIds.length > 0,
  ).length;

  const missingNextAction =
    open.length > 0 && unstarted.length === 0 && backlog.length === 0;

  const currentFocus = focusOf(items, features);
  const nextAction = nextActionOf(items);
  const currentFeature = (() => {
    const f = features.find((x) => x.status === "in_progress");
    return f ? { id: f.id, name: f.name } : null;
  })();

  const lastActivityAt = items.reduce<number | null>((max, i) => {
    if (max === null) return i.workItem.updatedAt;
    return i.workItem.updatedAt > max ? i.workItem.updatedAt : max;
  }, null);

  const suggestedNextStep = suggestNextStep({
    blockedCount,
    missingNextAction,
    staleCount,
    currentFocus,
    nextAction,
    openCount: open.length,
  });

  return {
    projectId,
    openCount: open.length,
    startedCount: started.length,
    unstartedCount: unstarted.length,
    backlogCount: backlog.length,
    currentFocus,
    currentFeature,
    nextAction,
    staleCount,
    blockedCount,
    missingNextAction,
    suggestedNextStep,
    lastActivityAt,
  };
}

function suggestNextStep(args: {
  blockedCount: number;
  missingNextAction: boolean;
  staleCount: number;
  currentFocus: HealthFocus | null;
  nextAction: HealthNextAction | null;
  openCount: number;
}): string {
  if (args.blockedCount > 0) {
    return `Resolve ${args.blockedCount} blocked item(s) in review.`;
  }
  if (args.missingNextAction) {
    return "Decide the next work item — nothing is queued.";
  }
  if (args.staleCount > 0) {
    return `Review ${args.staleCount} stale in-progress item(s).`;
  }
  if (args.currentFocus !== null) {
    return `Continue: ${args.currentFocus.title}.`;
  }
  if (args.openCount === 0) {
    return "Nothing open — consider closing or planning.";
  }
  if (args.nextAction !== null) {
    return `Start the highest-priority unstarted item: ${args.nextAction.identifier}.`;
  }
  return "No suggested next step.";
}

export const projectHealthService: ProjectHealthService = {
  async summarize(db, workspaceId, projectId, options?: SummarizeOptions) {
    const now = options?.now ?? Date.now();
    const { items, features } = await loadItemsWithMeta(db, workspaceId, projectId);
    return computeSummary(projectId, items, features, now);
  },

  async portfolio(db, workspaceId) {
    const now = Date.now();
    const projectRows = await db.all<{ id: string; name: string; portfolio_priority: string }>(
      "SELECT id, name, portfolio_priority FROM projects WHERE workspace_id = ? AND deleted_at IS NULL ORDER BY portfolio_priority ASC, created_at ASC",
      [workspaceId],
    );

    const byProject: ProjectHealthSummary[] = [];
    const atRisk: AtRiskProject[] = [];
    let openHigh = 0;

    for (const p of projectRows) {
      const { items, features } = await loadItemsWithMeta(db, workspaceId, p.id);
      const summary = computeSummary(p.id, items, features, now);
      byProject.push(summary);

      openHigh += items.filter(
        (i) =>
          (i.workItem.priority === "urgent" || i.workItem.priority === "high") &&
          i.workItem.statusGroup !== "completed" &&
          i.workItem.statusGroup !== "cancelled",
      ).length;

      const reasons: string[] = [];
      if (summary.blockedCount > 0) reasons.push(`${summary.blockedCount} blocked`);
      if (summary.staleCount > 0) reasons.push(`${summary.staleCount} stale`);
      if (summary.missingNextAction) reasons.push("no next action");
      if (reasons.length > 0) {
        atRisk.push({ projectId: p.id, projectName: p.name, reasons });
      }
    }

    return { byProject, atRisk, openHigh };
  },
};

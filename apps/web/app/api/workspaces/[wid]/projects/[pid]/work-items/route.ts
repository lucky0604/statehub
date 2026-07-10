import {
  workItemService,
  type WorkItemType,
  type Priority,
  type ConfidenceLevel,
  type StatusGroup,
  type WorkItemSource,
} from "@statehub/domain";
import { withEnvelope, parseBody, param, query, required } from "@/lib/api-handler";
import { db, getActor } from "@/lib/server";

export const runtime = "nodejs";

/**
 * Collect every value for a repeatable query key (state, priority, label,
 * source, confidence). Returns [] if absent.
 */
function allValues(req: Request, key: string): string[] {
  return req.url.includes("?") ? Array.from(new URL(req.url).searchParams.getAll(key)) : [];
}

export const GET = withEnvelope(async (req, params) => {
  const wid = param(params, "wid");
  const pid = param(params, "pid");
  const q = query(req);

  // Repeatable filters (URL: ?state=a&state=b ...)
  const stateIds = allValues(req, "state");
  const priorities = allValues(req, "priority") as Priority[];
  const labelIds = allValues(req, "label");
  const sources = allValues(req, "source") as WorkItemSource[];
  const confidences = allValues(req, "confidence") as ConfidenceLevel[];
  const statusGroups = allValues(req, "status_group") as StatusGroup[];

  const filter: Parameters<typeof workItemService.list>[3] = {};
  if (stateIds.length > 0) filter.stateIds = stateIds;
  if (priorities.length > 0) filter.priorities = priorities;
  if (labelIds.length > 0) filter.labelIds = labelIds;
  if (sources.length > 0) filter.sources = sources;
  if (confidences.length > 0) filter.confidences = confidences;
  if (statusGroups.length > 0) filter.statusGroups = statusGroups;

  // Single-value filters
  if (q.featureId !== undefined) {
    filter.featureId = q.featureId === "null" ? null : q.featureId;
  }
  if (q.type) filter.type = q.type as WorkItemType;
  if (q.search) filter.search = q.search;
  if (q.limit) filter.limit = Number(q.limit);
  if (q.orderBy) filter.orderBy = q.orderBy as "sequence" | "updated" | "priority";

  return workItemService.list(db(), wid, pid, filter);
});

export const POST = withEnvelope(async (req, params) => {
  const wid = param(params, "wid");
  const pid = param(params, "pid");
  const body = await parseBody<{
    title?: string;
    descriptionMarkdown?: string;
    stateId?: string;
    type?: WorkItemType;
    priority?: Priority;
    source?: WorkItemSource;
    confidence?: ConfidenceLevel;
    featureId?: string;
    parentWorkItemId?: string;
    startDate?: number;
    targetDate?: number;
    sortOrder?: number;
  }>(req);
  return workItemService.create(db(), getActor(), wid, pid, {
    title: required(body.title, "title"),
    descriptionMarkdown: body.descriptionMarkdown,
    stateId: body.stateId,
    type: body.type,
    priority: body.priority,
    source: body.source,
    confidence: body.confidence,
    featureId: body.featureId,
    parentWorkItemId: body.parentWorkItemId,
    startDate: body.startDate,
    targetDate: body.targetDate,
    sortOrder: body.sortOrder,
  });
});

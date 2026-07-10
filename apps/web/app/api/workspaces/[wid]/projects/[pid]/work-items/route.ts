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

export const GET = withEnvelope(async (req, params) => {
  const wid = param(params, "wid");
  const pid = param(params, "pid");
  const q = query(req);
  const filter: Parameters<typeof workItemService.list>[3] = {};
  if (q.stateId) filter.stateId = q.stateId;
  if (q.statusGroup) filter.statusGroup = q.statusGroup as StatusGroup;
  if (q.featureId !== undefined) {
    filter.featureId = q.featureId === "null" ? null : q.featureId;
  }
  if (q.priority) filter.priority = q.priority as Priority;
  if (q.type) filter.type = q.type as WorkItemType;
  if (q.search) filter.search = q.search;
  if (q.limit) filter.limit = Number(q.limit);
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

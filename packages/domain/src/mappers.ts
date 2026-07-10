/**
 * Row mappers — convert raw SQL rows (snake_case) to typed domain objects (camelCase).
 *
 * Every service method that returns an entity goes through a mapper. This keeps
 * the snake/camel boundary in one place so services stay clean.
 */
import type {
  Workspace,
  Project,
  State,
  Label,
  Feature,
  WorkItem,
  View,
  Cycle,
} from "@statehub/db";

type Row = Record<string, unknown>;

export function mapWorkspace(r: Row): Workspace {
  return {
    id: r.id as string,
    slug: r.slug as string,
    name: r.name as string,
    description: (r.description as string | null) ?? null,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
    deletedAt: (r.deleted_at as number | null) ?? null,
    version: r.version as number,
    createdBy: (r.created_by as string | null) ?? null,
    updatedBy: (r.updated_by as string | null) ?? null,
  };
}

export function mapProject(r: Row): Project {
  return {
    id: r.id as string,
    workspaceId: r.workspace_id as string,
    slug: r.slug as string,
    name: r.name as string,
    description: (r.description as string | null) ?? null,
    identifier: r.identifier as string,
    defaultStateId: (r.default_state_id as string | null) ?? null,
    defaultAssigneeId: (r.default_assignee_id as string | null) ?? null,
    type: (r.type as Project["type"]) ?? null,
    status: (r.status as Project["status"]) ?? "active",
    portfolioPriority: (r.portfolio_priority as Project["portfolioPriority"]) ?? "P1",
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
    deletedAt: (r.deleted_at as number | null) ?? null,
    version: r.version as number,
    createdBy: (r.created_by as string | null) ?? null,
    updatedBy: (r.updated_by as string | null) ?? null,
  };
}

export function mapState(r: Row): State {
  return {
    id: r.id as string,
    workspaceId: r.workspace_id as string,
    projectId: r.project_id as string,
    name: r.name as string,
    description: (r.description as string | null) ?? null,
    statusGroup: r.status_group as State["statusGroup"],
    color: (r.color as string | null) ?? null,
    sortOrder: r.sort_order as number,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
    deletedAt: (r.deleted_at as number | null) ?? null,
    version: r.version as number,
    createdBy: (r.created_by as string | null) ?? null,
    updatedBy: (r.updated_by as string | null) ?? null,
  };
}

export function mapLabel(r: Row): Label {
  return {
    id: r.id as string,
    workspaceId: r.workspace_id as string,
    projectId: r.project_id as string,
    name: r.name as string,
    color: (r.color as string | null) ?? null,
    sortOrder: r.sort_order as number,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
    deletedAt: (r.deleted_at as number | null) ?? null,
    version: r.version as number,
    createdBy: (r.created_by as string | null) ?? null,
    updatedBy: (r.updated_by as string | null) ?? null,
  };
}

export function mapFeature(r: Row): Feature {
  return {
    id: r.id as string,
    workspaceId: r.workspace_id as string,
    projectId: r.project_id as string,
    name: r.name as string,
    description: (r.description as string | null) ?? null,
    status: r.status as Feature["status"],
    sortOrder: r.sort_order as number,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
    deletedAt: (r.deleted_at as number | null) ?? null,
    version: r.version as number,
    createdBy: (r.created_by as string | null) ?? null,
    updatedBy: (r.updated_by as string | null) ?? null,
  };
}

export function mapWorkItem(r: Row): WorkItem {
  return {
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
}

export function mapView(r: Row): View {
  return {
    id: r.id as string,
    workspaceId: r.workspace_id as string,
    projectId: r.project_id as string,
    ownerId: (r.owner_id as string | null) ?? null,
    name: r.name as string,
    layout: r.layout as View["layout"],
    queryJson: r.query_json as string,
    displayJson: (r.display_json as string | null) ?? "{}",
    isDefault: r.is_default as number,
    sortOrder: r.sort_order as number,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
    deletedAt: (r.deleted_at as number | null) ?? null,
    version: r.version as number,
    createdBy: (r.created_by as string | null) ?? null,
    updatedBy: (r.updated_by as string | null) ?? null,
  };
}

export function mapCycle(r: Row): Cycle {
  return {
    id: r.id as string,
    workspaceId: r.workspace_id as string,
    projectId: r.project_id as string,
    name: r.name as string,
    status: r.status as Cycle["status"],
    startDate: (r.start_date as number | null) ?? null,
    endDate: (r.end_date as number | null) ?? null,
    sortOrder: r.sort_order as number,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
    deletedAt: (r.deleted_at as number | null) ?? null,
    version: r.version as number,
    createdBy: (r.created_by as string | null) ?? null,
    updatedBy: (r.updated_by as string | null) ?? null,
  };
}

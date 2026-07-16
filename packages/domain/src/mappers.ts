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
  AgentRun,
  Todo,
  Evidence,
  Review,
  ReviewFinding,
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

export function mapAgentRun(r: Row): AgentRun {
  return {
    id: r.id as string,
    workspaceId: r.workspace_id as string,
    projectId: r.project_id as string,
    featureId: (r.feature_id as string | null) ?? null,
    workItemId: (r.work_item_id as string | null) ?? null,
    agent: r.agent as string,
    model: (r.model as string | null) ?? null,
    runType: r.run_type as string,
    status: r.status as AgentRun["status"],
    summary: (r.summary as string | null) ?? null,
    filesChangedJson: r.files_changed_json as string,
    commandsRunJson: r.commands_run_json as string,
    testResult: (r.test_result as string | null) ?? null,
    commitSha: (r.commit_sha as string | null) ?? null,
    baseSha: (r.base_sha as string | null) ?? null,
    headSha: (r.head_sha as string | null) ?? null,
    gitBranch: (r.git_branch as string | null) ?? null,
    dirtyState: (r.dirty_state as string | null) ?? null,
    repoRemoteUrl: (r.repo_remote_url as string | null) ?? null,
    risksJson: r.risks_json as string,
    nextStepsJson: r.next_steps_json as string,
    rawArtifactUrl: (r.raw_artifact_url as string | null) ?? null,
    evidenceTrustState: r.evidence_trust_state as AgentRun["evidenceTrustState"],
    startedAt: r.started_at as number,
    finishedAt: (r.finished_at as number | null) ?? null,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
    deletedAt: (r.deleted_at as number | null) ?? null,
    version: r.version as number,
    createdBy: (r.created_by as string | null) ?? null,
    updatedBy: (r.updated_by as string | null) ?? null,
  };
}

export function mapTodo(r: Row): Todo {
  return {
    id: r.id as string,
    workspaceId: r.workspace_id as string,
    projectId: r.project_id as string,
    featureId: (r.feature_id as string | null) ?? null,
    workItemId: (r.work_item_id as string | null) ?? null,
    agentRunId: (r.agent_run_id as string | null) ?? null,
    title: r.title as string,
    description: (r.description as string | null) ?? null,
    status: r.status as Todo["status"],
    type: r.type as Todo["type"],
    priority: r.priority as Todo["priority"],
    source: r.source as Todo["source"],
    confidence: r.confidence as Todo["confidence"],
    evidenceRequired: r.evidence_required as number,
    evidenceSummary: (r.evidence_summary as string | null) ?? null,
    sortOrder: r.sort_order as number,
    completedAt: (r.completed_at as number | null) ?? null,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
    deletedAt: (r.deleted_at as number | null) ?? null,
    version: r.version as number,
    createdBy: (r.created_by as string | null) ?? null,
    updatedBy: (r.updated_by as string | null) ?? null,
  };
}

export function mapEvidence(r: Row): Evidence {
  return {
    id: r.id as string,
    workspaceId: r.workspace_id as string,
    projectId: r.project_id as string,
    featureId: (r.feature_id as string | null) ?? null,
    workItemId: (r.work_item_id as string | null) ?? null,
    agentRunId: (r.agent_run_id as string | null) ?? null,
    evidenceType: r.evidence_type as Evidence["evidenceType"],
    title: r.title as string,
    summary: (r.summary as string | null) ?? null,
    payloadJson: r.payload_json as string,
    artifactUrl: (r.artifact_url as string | null) ?? null,
    trustState: r.trust_state as Evidence["trustState"],
    stalenessState: r.staleness_state as Evidence["stalenessState"],
    createdAt: r.created_at as number,
    createdBy: (r.created_by as string | null) ?? null,
  };
}

export function mapReview(r: Row): Review {
  return {
    id: r.id as string,
    workspaceId: r.workspace_id as string,
    projectId: r.project_id as string,
    featureId: (r.feature_id as string | null) ?? null,
    workItemId: (r.work_item_id as string | null) ?? null,
    agentRunId: (r.agent_run_id as string | null) ?? null,
    reviewer: r.reviewer as string,
    model: (r.model as string | null) ?? null,
    verdict: r.verdict as Review["verdict"],
    summary: (r.summary as string | null) ?? null,
    confidence: r.confidence as Review["confidence"],
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
    deletedAt: (r.deleted_at as number | null) ?? null,
    version: r.version as number,
    createdBy: (r.created_by as string | null) ?? null,
    updatedBy: (r.updated_by as string | null) ?? null,
  };
}

export function mapReviewFinding(r: Row): ReviewFinding {
  return {
    id: r.id as string,
    workspaceId: r.workspace_id as string,
    reviewId: r.review_id as string,
    projectId: r.project_id as string,
    featureId: (r.feature_id as string | null) ?? null,
    workItemId: (r.work_item_id as string | null) ?? null,
    severity: r.severity as ReviewFinding["severity"],
    title: r.title as string,
    description: (r.description as string | null) ?? null,
    filePath: (r.file_path as string | null) ?? null,
    lineStart: (r.line_start as number | null) ?? null,
    lineEnd: (r.line_end as number | null) ?? null,
    suggestion: (r.suggestion as string | null) ?? null,
    status: r.status as ReviewFinding["status"],
    linkedWorkItemId: (r.linked_work_item_id as string | null) ?? null,
    linkedTodoId: (r.linked_todo_id as string | null) ?? null,
    dismissedReason: (r.dismissed_reason as string | null) ?? null,
    dismissedBy: (r.dismissed_by as string | null) ?? null,
    dismissedAt: (r.dismissed_at as number | null) ?? null,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
    deletedAt: (r.deleted_at as number | null) ?? null,
    version: r.version as number,
    createdBy: (r.created_by as string | null) ?? null,
    updatedBy: (r.updated_by as string | null) ?? null,
  };
}

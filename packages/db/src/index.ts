// Schema exports
export { baseColumns, auditedColumns } from "./schema/index";
export {
  events,
  EVENT_TYPES,
  type Event,
  type NewEvent,
  type EventType,
} from "./schema/index";
export { users, type User, type NewUser } from "./schema/index";
export { workspaces, type Workspace, type NewWorkspace } from "./schema/index";
export {
  workspaceMembers,
  WORKSPACE_ROLES,
  type WorkspaceRole,
  type WorkspaceMember,
  type NewWorkspaceMember,
} from "./schema/index";
export { projects, type Project, type NewProject } from "./schema/index";
export {
  PROJECT_TYPES,
  PROJECT_STATUSES,
  PORTFOLIO_PRIORITIES,
  type ProjectType,
  type ProjectStatus,
  type PortfolioPriority,
} from "./schema/index";
export {
  states,
  STATUS_GROUPS,
  type StatusGroup,
  type State,
  type NewState,
} from "./schema/index";
export { labels, type Label, type NewLabel } from "./schema/index";
export {
  features,
  FEATURE_STATUSES,
  type FeatureStatus,
  type Feature,
  type NewFeature,
} from "./schema/index";
export {
  workItems,
  WORK_ITEM_TYPES,
  PRIORITIES,
  CONFIDENCE_LEVELS,
  WORK_ITEM_SOURCES,
  type WorkItemType,
  type Priority,
  type ConfidenceLevel,
  type WorkItemSource,
  type WorkItem,
  type NewWorkItem,
} from "./schema/index";
export {
  workItemLabels,
  type WorkItemLabel,
  type NewWorkItemLabel,
} from "./schema/index";
export {
  projectCounters,
  type ProjectCounter,
  type NewProjectCounter,
} from "./schema/index";
export {
  views,
  VIEW_LAYOUTS,
  type ViewLayout,
  type View,
  type NewView,
} from "./schema/index";
export {
  cycles,
  CYCLE_STATUSES,
  type CycleStatus,
  type Cycle,
  type NewCycle,
} from "./schema/index";
export {
  agentRuns,
  AGENT_RUN_STATUSES,
  EVIDENCE_TRUST_STATES,
  type AgentRunStatus,
  type EvidenceTrustState,
  type AgentRun,
  type NewAgentRun,
} from "./schema/index";
export {
  todos,
  TODO_STATUSES,
  TODO_TYPES,
  type TodoStatus,
  type TodoType,
  type Todo,
  type NewTodo,
} from "./schema/index";
export {
  evidence,
  EVIDENCE_STALENESS_STATES,
  EVIDENCE_TYPES,
  type EvidenceStalenessState,
  type EvidenceType,
  type Evidence,
  type NewEvidence,
} from "./schema/index";
export {
  personalTokens,
  TOKEN_SCOPES,
  type TokenScope,
  type PersonalToken,
  type NewPersonalToken,
} from "./schema/index";
export {
  idempotencyRecords,
  type IdempotencyRecord,
  type NewIdempotencyRecord,
} from "./schema/index";
export {
  reviews,
  REVIEW_VERDICTS,
  type ReviewVerdict,
  type Review,
  type NewReview,
} from "./schema/index";
export {
  reviewFindings,
  FINDING_SEVERITIES,
  FINDING_STATUSES,
  type FindingSeverity,
  type FindingStatus,
  type ReviewFinding,
  type NewReviewFinding,
} from "./schema/index";

// D1 binding accessor (production / wrangler dev)
export { setD1Binding, getD1, hasD1 } from "./client";

// D1-only client factory (Cloudflare Workers). No better-sqlite3 in the graph.
export { createD1Client } from "./d1-client";

// Unified DB client types only. The runtime getDb()/setDbClient() live in the
// node-only subpath (@statehub/db/node) so importing @statehub/db never pulls
// better-sqlite3 / node:* into a Cloudflare Worker bundle.
export { type DbClient, type SqlStmt, type SqlBindValue } from "./db-client";

// Transaction + event append
export {
  type WithEvent,
  type EventInput,
  type ActorContext,
  withEvent,
  buildEventStmt,
} from "./transaction";

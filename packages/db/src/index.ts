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

// D1 binding accessor (production / wrangler dev)
export { setD1Binding, getD1, hasD1 } from "./client";

// Local SQLite client (next dev)
export { getLocalDb, getRawDb, hasLocalDb } from "./local-client";

// In-memory DB factory (tests)
export { createInMemoryDb } from "./test-db";

// Unified DB client (auto-picks D1 or local)
export {
  type DbClient,
  type SqlStmt,
  type SqlBindValue,
  getDb,
  setDbClient,
} from "./db-client";

// Transaction + event append
export {
  type WithEvent,
  type EventInput,
  type ActorContext,
  withEvent,
  buildEventStmt,
} from "./transaction";

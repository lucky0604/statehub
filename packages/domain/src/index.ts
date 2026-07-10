// Actor context builders
export { SOLO_ACTOR, mcpActor, aiPmActor } from "./actor";

// Re-exported types from @statehub/db so consumers can import from one place.
export {
  type ActorContext,
  type EventType,
  type Workspace,
  type Project,
  type State,
  type StatusGroup,
  type Label,
  type Feature,
  type FeatureStatus,
  type WorkItem,
  type WorkItemType,
  type Priority,
  type ConfidenceLevel,
  type WorkItemSource,
  type DbClient,
  type SqlStmt,
  type SqlBindValue,
} from "@statehub/db";

// Domain errors
export {
  DomainError,
  NotFoundError,
  AlreadyExistsError,
  ConflictError,
  ValidationError,
  ForbiddenError,
} from "./errors";

// Services
export {
  sequenceService,
  type SequenceService,
  workspaceService,
  type WorkspaceService,
  type CreateWorkspaceInput,
  type UpdateWorkspaceInput,
  projectService,
  type ProjectService,
  type CreateProjectInput,
  type UpdateProjectInput,
  stateService,
  type StateService,
  type CreateStateInput,
  type UpdateStateInput,
  labelService,
  type LabelService,
  type CreateLabelInput,
  type UpdateLabelInput,
  featureService,
  type FeatureService,
  type CreateFeatureInput,
  type UpdateFeatureInput,
  workItemService,
  type WorkItemService,
  type CreateWorkItemInput,
  type UpdateWorkItemInput,
  type ListWorkItemsFilter,
} from "./services";

// Row mappers (for raw row -> typed object conversion in API routes)
export {
  mapWorkspace,
  mapProject,
  mapState,
  mapLabel,
  mapFeature,
  mapWorkItem,
} from "./mappers";

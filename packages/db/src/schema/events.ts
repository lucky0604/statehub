/**
 * events table — append-only audit log.
 *
 * Source: agent_flow/implementation/v1/02-cross-cutting-architecture.md §7
 *         agent_flow/implementation/v1/03-data-contracts-and-db-invariants.md §8
 *         agent_flow/prd/v1.md §10.21
 *
 * Every state mutation MUST append an event in the same transaction.
 * This table is append-only — NO updated_at, NO deleted_at, NO version.
 *
 * Indexes match the three query patterns:
 *   - by entity: "show me the history of this work item"
 *   - by type:   "show me all project.created events in this workspace"
 *   - by idem:   "did we already process this idempotency_key?"
 */
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    projectId: text("project_id"),
    featureId: text("feature_id"),
    workItemId: text("work_item_id"),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    eventType: text("event_type").notNull(),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id"),
    actorName: text("actor_name").notNull(),
    source: text("source").notNull(),
    idempotencyKey: text("idempotency_key"),
    payloadJson: text("payload_json").notNull(),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    index("idx_events_workspace_entity").on(
      table.workspaceId,
      table.entityType,
      table.entityId,
      table.createdAt,
    ),
    index("idx_events_workspace_type").on(
      table.workspaceId,
      table.eventType,
      table.createdAt,
    ),
    index("idx_events_workspace_idem").on(
      table.workspaceId,
      table.idempotencyKey,
    ),
  ],
);

export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;

/**
 * Canonical event types. Source: PRD §10.21 (examples — list is not closed).
 *
 * P01A extends the PRD examples with update/delete events for every managed
 * entity, plus workspace.* events. The PRD's list was illustrative; every
 * state mutation appends an event per data-contracts §8, so the type list
 * needs to cover every mutation kind we emit.
 */
export const EVENT_TYPES = [
  // workspace
  "workspace.created",
  "workspace.updated",
  "workspace.deleted",
  // project
  "project.created",
  "project.updated",
  "project.deleted",
  // state
  "state.created",
  "state.updated",
  "state.deleted",
  // label
  "label.created",
  "label.updated",
  "label.deleted",
  // feature
  "feature.created",
  "feature.updated",
  "feature.status_changed",
  "feature.deleted",
  // work item
  "work_item.created",
  "work_item.updated",
  "work_item.status_changed",
  "work_item.deleted",
  // view
  "view.created",
  "view.updated",
  "view.deleted",
  // cycle
  "cycle.created",
  "cycle.updated",
  "cycle.deleted",
  // PRD §10.21 examples not yet emitted (reserved for later phases)
  "todo.upserted",
  "todo.status_changed",
  "agent_run.started",
  "agent_run.completed",
  "review.submitted",
  "finding.created",
  "decision.recorded",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

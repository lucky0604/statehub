/**
 * work_item_labels — join table between work items and labels.
 *
 * Source: agent_flow/implementation/v1/03-data-contracts-and-db-invariants.md §2
 *
 * Composite primary key (work_item_id, label_id). No soft delete — deleting a
 * label assignment removes the row.
 */
import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const workItemLabels = sqliteTable(
  "work_item_labels",
  {
    workspaceId: text("workspace_id").notNull(),
    workItemId: text("work_item_id").notNull(),
    labelId: text("label_id").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_wil_work_item").on(table.workItemId),
    index("idx_wil_label").on(table.labelId),
  ],
);

export type WorkItemLabel = typeof workItemLabels.$inferSelect;
export type NewWorkItemLabel = typeof workItemLabels.$inferInsert;

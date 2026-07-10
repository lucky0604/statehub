/**
 * work_item_labels — join table between work items and labels.
 *
 * Source: agent_flow/implementation/v1/03-data-contracts-and-db-invariants.md §2
 *
 * Composite primary key (work_item_id, label_id) — duplicate label assignments
 * are rejected by the PK. No soft delete — removing a label assignment deletes
 * the row. created_at is integer ms (unixepoch * 1000), matching every other
 * audited table.
 *
 * P01B fix (P01A review deferred item): the table previously had no PK and
 * stored created_at as text. Migration 0002 adds the composite PK and converts
 * the column.
 */
import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const workItemLabels = sqliteTable(
  "work_item_labels",
  {
    workspaceId: text("workspace_id").notNull(),
    workItemId: text("work_item_id").notNull(),
    labelId: text("label_id").notNull(),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    primaryKey({ columns: [table.workItemId, table.labelId] }),
    index("idx_wil_work_item").on(table.workItemId),
    index("idx_wil_label").on(table.labelId),
  ],
);

export type WorkItemLabel = typeof workItemLabels.$inferSelect;
export type NewWorkItemLabel = typeof workItemLabels.$inferInsert;

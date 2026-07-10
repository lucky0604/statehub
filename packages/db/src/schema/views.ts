/**
 * views table — saved filter+display presets for a project's work items.
 *
 * Source: agent_flow/implementation/v1/phases/phase-01-plane-like-core-project-health-summary.md §2.3, §4.6
 *         agent_flow/statehub-design-system.md §10.4
 *         agent_flow/implementation/v1/03-data-contracts-and-db-invariants.md §3 (saved view name within project scope)
 *
 * A view stores the full query (filters) and display (layout/group_by/order_by/
 * visible_columns) spec as JSON. Applying a view writes its filters into the URL
 * — the URL is the source of truth at render time; the view row is a named preset.
 *
 * Name is unique within (project_id, owner_id) among non-deleted views. owner_id
 * is null for solo dev (project-scoped). Multi-user scopes it per user later.
 */
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const VIEW_LAYOUTS = ["list", "kanban"] as const;
export type ViewLayout = (typeof VIEW_LAYOUTS)[number];

export const views = sqliteTable(
  "views",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    projectId: text("project_id").notNull(),
    /** Solo dev = null. Multi-user scopes the name uniqueness per user. */
    ownerId: text("owner_id"),
    name: text("name").notNull(),
    layout: text("layout", { enum: VIEW_LAYOUTS }).notNull().default("list"),
    /** JSON: ViewQuery (filters). See domain/services/view.ts. */
    queryJson: text("query_json").notNull(),
    /** JSON: ViewDisplay (group_by/order_by/visible_columns). */
    displayJson: text("display_json").notNull().default("{}"),
    /** Seeded default views (Current Focus, Open Work, ...). 0 = user-created. */
    isDefault: integer("is_default").notNull().default(0),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    deletedAt: integer("deleted_at"),
    version: integer("version").notNull().default(1),
    createdBy: text("created_by"),
    updatedBy: text("updated_by"),
  },
  (table) => [
    uniqueIndex("idx_views_project_name")
      .on(table.projectId, table.ownerId, table.name)
      .where(sql`deleted_at IS NULL`),
    index("idx_views_project").on(table.projectId, table.sortOrder),
  ],
);

export type View = typeof views.$inferSelect;
export type NewView = typeof views.$inferInsert;

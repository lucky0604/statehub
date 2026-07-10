/**
 * workspace_members — links users to workspaces with a role.
 *
 * Source: agent_flow/implementation/v1/04-security-auth-permissions.md §4
 *
 * P01A: one row linking the solo user to the solo workspace as owner.
 */
import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const WORKSPACE_ROLES = [
  "owner",
  "admin",
  "member",
  "viewer",
  "agent",
] as const;

export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const workspaceMembers = sqliteTable(
  "workspace_members",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id").notNull(),
    userId: text("user_id").notNull(),
    role: text("role", { enum: WORKSPACE_ROLES }).notNull(),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    updatedAt: integer("updated_at")
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
    deletedAt: integer("deleted_at"),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    uniqueIndex("idx_workspace_members_ws_user")
      .on(table.workspaceId, table.userId)
      .where(sql`deleted_at IS NULL`),
  ],
);

export type WorkspaceMember = typeof workspaceMembers.$inferSelect;
export type NewWorkspaceMember = typeof workspaceMembers.$inferInsert;

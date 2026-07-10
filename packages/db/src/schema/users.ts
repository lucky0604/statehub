/**
 * users table — solo dev user at P01A.
 *
 * Source: agent_flow/implementation/v1/03-data-contracts-and-db-invariants.md §2
 *         agent_flow/implementation/v1/04-security-auth-permissions.md §1
 *
 * P01A: one user, created by db:seed. No auth implementation yet — the actor
 * context hardcodes the seed user id. Auth lands pre-P02.
 */
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  deletedAt: integer("deleted_at"),
  version: integer("version").notNull().default(1),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

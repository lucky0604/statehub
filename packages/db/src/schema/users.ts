/**
 * users table — solo dev user at P01A.
 *
 * Source: agent_flow/implementation/v1/03-data-contracts-and-db-invariants.md §2
 *         agent_flow/implementation/v1/04-security-auth-permissions.md §1
 *
 * P01A: one user, created by db:seed. No auth implementation yet — the actor
 * context hardcodes the seed user id. Auth lands pre-P02.
 *
 * P08B: `password_hash` column added for bcrypt hashes. Null for legacy
 * seed users (pre-P08B) — they can't log in until `add-user` sets a
 * password. The `User` type exposed by `@statehub/db` intentionally does
 * NOT include `passwordHash` — the domain mapper strips it to avoid
 * leaking hashes into event payloads or API responses.
 */
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  /**
   * P08B: bcrypt password hash (12 rounds). Null for users created
   * before P08B (legacy seed) — they must reset/set a password via
   * `add-user` before they can log in.
   */
  passwordHash: text("password_hash"),
  createdAt: integer("created_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  deletedAt: integer("deleted_at"),
  version: integer("version").notNull().default(1),
});

/**
 * Public User type — omits `passwordHash` so hashes can't leak into event
 * payloads or API responses by accident. Callers that need the hash (only
 * the auth service's login path) query the row directly.
 */
export type User = Omit<typeof users.$inferSelect, "passwordHash">;
export type NewUser = typeof users.$inferInsert;

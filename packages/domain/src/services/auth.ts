/**
 * Auth service — password hashing, user creation, login, session verification.
 *
 * Source: agent_flow/implementation/v1/iterations/20260719-p08b-basic-auth/plan.md §3.4
 *
 * `bcryptjs` (pure JS) is used instead of native `bcrypt` because Cloudflare
 * Workers' nodejs_compat doesn't ship native bcrypt. 12 rounds ≈ 250ms, fine
 * for a single-user login.
 *
 * The `User` type returned here omits `passwordHash` — the mapper strips it.
 * Only `login` reads the hash, and it does so off a private row type so the
 * hash never escapes this module.
 */
import bcrypt from "bcryptjs";
import type { DbClient, User } from "@statehub/db";
import { DomainError, NotFoundError } from "../errors";
import { signSession, verifySession, type SessionPayload } from "../auth/session";

const BCRYPT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 8;

interface UserRow {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  password_hash: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  version: number;
}

export interface AuthService {
  hashPassword(plain: string): Promise<string>;
  verifyPassword(plain: string, hash: string): Promise<boolean>;
  createUser(db: DbClient, input: { email: string; name: string; password: string }): Promise<User>;
  login(
    db: DbClient,
    email: string,
    password: string,
    secret: string,
  ): Promise<{ user: User; token: string } | null>;
  getUserById(db: DbClient, userId: string): Promise<User | null>;
  verifyToken(token: string, secret: string): Promise<SessionPayload | null>;
}

export const authService: AuthService = {
  async hashPassword(plain) {
    if (plain.length < MIN_PASSWORD_LENGTH) {
      throw new DomainError(
        "validation_error",
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      );
    }
    return bcrypt.hash(plain, BCRYPT_ROUNDS);
  },

  async verifyPassword(plain, hash) {
    if (!hash) return false;
    return bcrypt.compare(plain, hash);
  },

  async createUser(db, input) {
    const email = input.email.trim().toLowerCase();
    const name = input.name.trim();
    if (!email) throw new DomainError("validation_error", "email is required");
    if (!name) throw new DomainError("validation_error", "name is required");

    const passwordHash = await this.hashPassword(input.password);
    const id = crypto.randomUUID();
    const now = Date.now();
    await db.run(
      `INSERT INTO users (id, email, name, password_hash, created_at, updated_at, version)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [id, email, name, passwordHash, now, now],
    );
    const row = await db.first<UserRow>("SELECT * FROM users WHERE id = ?", [id]);
    if (!row) throw new DomainError("internal_error", "user insert failed");
    return mapUser(row);
  },

  async login(db, email, password, secret) {
    const row = await db.first<UserRow>(
      "SELECT * FROM users WHERE email = ? AND deleted_at IS NULL",
      [email.trim().toLowerCase()],
    );
    if (!row) return null;
    if (!row.password_hash) return null;
    const ok = await bcrypt.compare(password, row.password_hash);
    if (!ok) return null;
    const user = mapUser(row);
    const token = await signSession(user.id, secret);
    return { user, token };
  },

  async getUserById(db, userId) {
    const row = await db.first<UserRow>(
      "SELECT * FROM users WHERE id = ? AND deleted_at IS NULL",
      [userId],
    );
    if (!row) return null;
    return mapUser(row);
  },

  async verifyToken(token, secret) {
    return verifySession(token, secret);
  },
};

function mapUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatar_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    version: row.version,
  };
}

/** Resolve a user id to a non-null user or throw NotFoundError. */
export async function requireUser(db: DbClient, userId: string): Promise<User> {
  const user = await authService.getUserById(db, userId);
  if (!user) throw new NotFoundError("user", userId);
  return user;
}

/**
 * Repo alias service — manage alternate remote URLs accepted as identity
 * matches for a project.
 *
 * Source: agent_flow/implementation/v1/phases/phase-04-local-mcp-sidecar.md §3, §5
 *
 * The local MCP sidecar sends `repo_remote_url` with each evidence payload;
 * the remote matches it against projects.repo_url + project_repo_aliases.
 * Aliases are normalized via normalizeRepoUrl() before storage so the
 * (workspace_id, alias_url) UNIQUE index collapses equivalent URLs.
 */
import {
  type DbClient,
  type ActorContext,
  type ProjectRepoAlias,
  type SqlBindValue,
  withEvent,
} from "@statehub/db";
import { normalizeRepoUrl } from "@statehub/shared";
import { mapProjectRepoAlias } from "../mappers";
import { AlreadyExistsError, NotFoundError, ValidationError } from "../errors";

export interface RepoAliasService {
  list(db: DbClient, workspaceId: string, projectId: string): Promise<ProjectRepoAlias[]>;
  add(
    db: DbClient,
    actor: ActorContext,
    workspaceId: string,
    projectId: string,
    aliasUrl: string,
  ): Promise<ProjectRepoAlias>;
  remove(
    db: DbClient,
    actor: ActorContext,
    workspaceId: string,
    projectId: string,
    aliasId: string,
  ): Promise<void>;
  /**
   * Find a project in the workspace whose repo_url or any alias normalizes
   * to `normalizedUrl`. Returns the project_id + match status:
   *   matched        — projects.repo_url equals normalizedUrl
   *   alias_matched  — a project_repo_aliases row equals normalizedUrl
   *   unknown        — no match
   */
  resolveProjectByRepoUrl(
    db: DbClient,
    workspaceId: string,
    normalizedUrl: string,
  ): Promise<{ projectId: string; matchStatus: "matched" | "alias_matched" } | null>;
}

async function lookupProject(
  db: DbClient,
  workspaceId: string,
  projectId: string,
): Promise<{ id: string }> {
  const row = await db.first<{ id: string }>(
    "SELECT id FROM projects WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL",
    [projectId, workspaceId],
  );
  if (!row) throw new NotFoundError("project", projectId);
  return row;
}

export const repoAliasService: RepoAliasService = {
  async list(db, workspaceId, projectId) {
    await lookupProject(db, workspaceId, projectId);
    const rows = await db.all<Record<string, unknown>>(
      "SELECT * FROM project_repo_aliases WHERE workspace_id = ? AND project_id = ? ORDER BY created_at ASC",
      [workspaceId, projectId],
    );
    return rows.map(mapProjectRepoAlias);
  },

  async add(db, actor, workspaceId, projectId, aliasUrl) {
    if (!aliasUrl?.trim()) throw new ValidationError("alias_url is required");
    await lookupProject(db, workspaceId, projectId);

    const normalized = normalizeRepoUrl(aliasUrl);

    // Reject if the alias matches the project's own repo_url — that's not an alias.
    const project = await db.first<{ repo_url: string | null }>(
      "SELECT repo_url FROM projects WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL",
      [projectId, workspaceId],
    );
    if (project?.repo_url && project.repo_url === normalized) {
      throw new ValidationError("alias_url matches the project's repo_url");
    }

    // Reject duplicates within the workspace (same alias attached to any project).
    const dup = await db.first<{ id: string; project_id: string }>(
      "SELECT id, project_id FROM project_repo_aliases WHERE workspace_id = ? AND alias_url = ?",
      [workspaceId, normalized],
    );
    if (dup) {
      if (dup.project_id === projectId) {
        throw new AlreadyExistsError("repo_alias", normalized);
      }
      throw new AlreadyExistsError("repo_alias_in_use", normalized);
    }

    const id = crypto.randomUUID();
    const params: SqlBindValue[] = [id, workspaceId, projectId, normalized, actor.id ?? null];

    await withEvent(
      db,
      {
        workspaceId,
        projectId,
        entityType: "project",
        entityId: projectId,
        eventType: "project.repo_alias_added",
        actor,
        source: actor.type === "user" ? "user" : actor.type,
        payload: { aliasId: id, aliasUrl: normalized, projectId },
      },
      () => [
        {
          sql: "INSERT INTO project_repo_aliases (id, workspace_id, project_id, alias_url, created_by) VALUES (?, ?, ?, ?, ?)",
          params,
        },
      ],
    );

    const row = await db.first<Record<string, unknown>>(
      "SELECT * FROM project_repo_aliases WHERE id = ?",
      [id],
    );
    if (!row) throw new Error("repo alias insert failed");
    return mapProjectRepoAlias(row);
  },

  async remove(db, actor, workspaceId, projectId, aliasId) {
    await lookupProject(db, workspaceId, projectId);
    const existing = await db.first<{ id: string }>(
      "SELECT id FROM project_repo_aliases WHERE id = ? AND workspace_id = ? AND project_id = ?",
      [aliasId, workspaceId, projectId],
    );
    if (!existing) throw new NotFoundError("repo_alias", aliasId);

    await withEvent(
      db,
      {
        workspaceId,
        projectId,
        entityType: "project",
        entityId: projectId,
        eventType: "project.repo_alias_removed",
        actor,
        source: actor.type === "user" ? "user" : actor.type,
        payload: { aliasId, projectId },
      },
      () => [
        {
          sql: "DELETE FROM project_repo_aliases WHERE id = ? AND workspace_id = ? AND project_id = ?",
          params: [aliasId, workspaceId, projectId],
        },
      ],
    );
  },

  async resolveProjectByRepoUrl(db, workspaceId, normalizedUrl) {
    // Try the project's own repo_url first.
    const byRepoUrl = await db.first<{ id: string }>(
      "SELECT id FROM projects WHERE workspace_id = ? AND repo_url = ? AND deleted_at IS NULL",
      [workspaceId, normalizedUrl],
    );
    if (byRepoUrl) {
      return { projectId: byRepoUrl.id, matchStatus: "matched" };
    }

    const byAlias = await db.first<{ project_id: string }>(
      "SELECT project_id FROM project_repo_aliases WHERE workspace_id = ? AND alias_url = ?",
      [workspaceId, normalizedUrl],
    );
    if (byAlias) {
      return { projectId: byAlias.project_id, matchStatus: "alias_matched" };
    }

    return null;
  },
};

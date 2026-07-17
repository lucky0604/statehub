/**
 * Integration service — manage workspace-level external provider configs
 * (GitHub repos for P06B; Plane/Linear land in P06C).
 *
 * Source: agent_flow/implementation/v1/phases/phase-06-import-integration.md
 *         §4.1 (integrations table), §3 principle 3 (every imported entity
 *         stores external_source and external_id — the integration is the
 *         per-workspace source-of-truth for that provider config).
 *
 * PAT (personal access token) is stored in config_json plaintext — same
 * trust model as personal_tokens (local-only solo-dev app). Events strip
 * the PAT from their payloads; the mapper + GET responses return pat: null
 * so the PAT never leaves the server after creation.
 */
import {
  type DbClient,
  type ActorContext,
  type Integration,
  type IntegrationProvider,
  type IntegrationStatus,
  type SqlBindValue,
  withEvent,
} from "@statehub/db";
import { mapIntegration } from "../mappers";
import { NotFoundError, ValidationError } from "../errors";

export interface IntegrationService {
  create(
    db: DbClient,
    actor: ActorContext,
    workspaceId: string,
    input: CreateIntegrationInput,
  ): Promise<Integration>;
  list(
    db: DbClient,
    workspaceId: string,
    filter?: { provider?: IntegrationProvider },
  ): Promise<Integration[]>;
  get(db: DbClient, workspaceId: string, id: string): Promise<Integration | null>;
  update(
    db: DbClient,
    actor: ActorContext,
    workspaceId: string,
    id: string,
    patch: UpdateIntegrationInput,
  ): Promise<Integration>;
  remove(db: DbClient, actor: ActorContext, workspaceId: string, id: string): Promise<void>;
}

export interface CreateIntegrationInput {
  provider: IntegrationProvider;
  name: string;
  config: { repo?: string; pat?: string; [key: string]: unknown };
}

export interface UpdateIntegrationInput {
  name?: string;
  config?: { repo?: string; pat?: string; [key: string]: unknown };
  status?: IntegrationStatus;
}

/**
 * Strip secrets (pat) from a config object before writing it to an event
 * payload. Returns a shallow copy with `pat` removed.
 */
function stripSecrets(config: {
  repo?: string;
  pat?: string;
  [key: string]: unknown;
}): { repo?: string; [key: string]: unknown } {
  const { pat: _pat, ...rest } = config;
  return rest;
}

export const integrationService: IntegrationService = {
  async create(db, actor, workspaceId, input) {
    if (!input.name?.trim()) throw new ValidationError("name is required");
    if (!input.config?.repo?.trim()) {
      throw new ValidationError("config.repo is required");
    }

    const id = crypto.randomUUID();
    const configJson = JSON.stringify(input.config);
    const params: SqlBindValue[] = [
      id,
      workspaceId,
      input.provider,
      input.name,
      configJson,
      "active",
      actor.id ?? null,
    ];

    await withEvent(
      db,
      {
        workspaceId,
        entityType: "integration",
        entityId: id,
        eventType: "integration.created",
        actor,
        source: actor.type === "user" ? "user" : actor.type,
        payload: {
          after: {
            id,
            provider: input.provider,
            name: input.name,
            config: stripSecrets(input.config),
          },
        },
      },
      () => [
        {
          sql: `
            INSERT INTO integrations (
              id, workspace_id, provider, name, config_json, status, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
          params,
        },
      ],
    );

    const row = await db.first<Record<string, unknown>>(
      "SELECT * FROM integrations WHERE id = ?",
      [id],
    );
    if (!row) throw new Error("integration insert failed");
    return mapIntegration(row);
  },

  async list(db, workspaceId, filter) {
    const conditions = ["workspace_id = ?"];
    const params: SqlBindValue[] = [workspaceId];
    if (filter?.provider) {
      conditions.push("provider = ?");
      params.push(filter.provider);
    }
    const sql = `SELECT * FROM integrations WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC`;
    const rows = await db.all<Record<string, unknown>>(sql, params);
    return rows.map(mapIntegration);
  },

  async get(db, workspaceId, id) {
    const row = await db.first<Record<string, unknown>>(
      "SELECT * FROM integrations WHERE id = ? AND workspace_id = ?",
      [id, workspaceId],
    );
    return row ? mapIntegration(row) : null;
  },

  async update(db, actor, workspaceId, id, patch) {
    const existing = await integrationService.get(db, workspaceId, id);
    if (!existing) throw new NotFoundError("integration", id);

    const sets: string[] = [];
    const params: SqlBindValue[] = [];
    let nextConfig: { repo?: string; pat?: string; [key: string]: unknown } | undefined;

    if (patch.name !== undefined) {
      if (!patch.name.trim()) throw new ValidationError("name cannot be empty");
      sets.push("name = ?");
      params.push(patch.name);
    }
    if (patch.config !== undefined) {
      nextConfig = patch.config;
      sets.push("config_json = ?");
      params.push(JSON.stringify(patch.config));
    }
    if (patch.status !== undefined) {
      sets.push("status = ?");
      params.push(patch.status);
    }
    if (sets.length === 0) return existing;

    params.push(id);
    params.push(workspaceId);

    await withEvent(
      db,
      {
        workspaceId,
        entityType: "integration",
        entityId: id,
        eventType: "integration.updated",
        actor,
        source: actor.type === "user" ? "user" : actor.type,
        payload: {
          before: {
            id,
            name: existing.name,
            config: stripSecrets(JSON.parse(existing.configJson) as { pat?: string }),
          },
          after: {
            id,
            name: patch.name ?? existing.name,
            config: nextConfig ? stripSecrets(nextConfig) : undefined,
            status: patch.status,
          },
        },
      },
      () => [
        {
          sql: `UPDATE integrations SET ${sets.join(", ")} WHERE id = ? AND workspace_id = ?`,
          params,
        },
      ],
    );

    const row = await db.first<Record<string, unknown>>(
      "SELECT * FROM integrations WHERE id = ?",
      [id],
    );
    if (!row) throw new Error("integration update failed");
    return mapIntegration(row);
  },

  async remove(db, actor, workspaceId, id) {
    const existing = await integrationService.get(db, workspaceId, id);
    if (!existing) throw new NotFoundError("integration", id);

    await withEvent(
      db,
      {
        workspaceId,
        entityType: "integration",
        entityId: id,
        eventType: "integration.removed",
        actor,
        source: actor.type === "user" ? "user" : actor.type,
        payload: {
          before: {
            id,
            provider: existing.provider,
            name: existing.name,
            config: stripSecrets(JSON.parse(existing.configJson) as { pat?: string }),
          },
        },
      },
      () => [
        {
          sql: "DELETE FROM integrations WHERE id = ? AND workspace_id = ?",
          params: [id, workspaceId],
        },
      ],
    );
  },
};

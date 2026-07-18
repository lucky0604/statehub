/**
 * Integration service — manage workspace-level external provider configs
 * (GitHub repos for P06B; Plane/Linear land in P06C).
 *
 * Source: agent_flow/implementation/v1/phases/phase-06-import-integration.md
 *         §4.1 (integrations table), §3 principle 3 (every imported entity
 *         stores external_source and external_id — the integration is the
 *         per-workspace source-of-truth for that provider config).
 *
 * P07D: provider tokens (`pat`, `api_token`, `api_key`) are encrypted at
 * rest with AES-256-GCM before being written to `config_json`. The
 * mapper masks them as `••••` in GET responses. The fetch route uses
 * `getDecryptedConfig` to recover plaintext tokens for the provider
 * API call. Event payloads continue to strip secrets via `stripSecrets`.
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
import { NotFoundError, ValidationError, DomainError } from "../errors";
import {
  encryptSecret,
  decryptSecret,
  isEncrypted,
  CryptoError,
  type CryptoOpts,
} from "../crypto";
import { SECRET_FIELDS } from "../provider-secrets";

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
  getDecryptedConfig(
    db: DbClient,
    workspaceId: string,
    id: string,
    opts?: CryptoOpts,
  ): Promise<{ provider: IntegrationProvider; config: Record<string, unknown> } | null>;
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
 * Encrypt secret fields in a config before writing to config_json.
 * Skips values that are already encrypted (idempotent on re-save).
 */
function encryptConfig(
  provider: IntegrationProvider,
  config: Record<string, unknown>,
  opts?: CryptoOpts,
): Record<string, unknown> {
  const out = { ...config };
  for (const field of SECRET_FIELDS[provider] ?? []) {
    const v = out[field];
    if (typeof v === "string" && v.length > 0 && !isEncrypted(v)) {
      out[field] = encryptSecret(v, opts);
    }
  }
  return out;
}

function decryptConfig(
  provider: IntegrationProvider,
  config: Record<string, unknown>,
  opts?: CryptoOpts,
): Record<string, unknown> {
  const out = { ...config };
  for (const field of SECRET_FIELDS[provider] ?? []) {
    const v = out[field];
    if (typeof v === "string" && isEncrypted(v)) {
      out[field] = decryptSecret(v, opts);
    }
  }
  return out;
}

/**
 * Strip ALL secret fields from a config before writing it to an event
 * payload. Event payloads must not contain tokens — encrypted or not,
 * the ciphertext is still sensitive metadata.
 */
function stripSecrets(
  provider: IntegrationProvider,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...config };
  for (const field of SECRET_FIELDS[provider] ?? []) {
    delete out[field];
  }
  return out;
}

/**
 * Wrap CryptoError as DomainError so the API handler's existing
 * DomainError path produces a clean 500 envelope.
 */
function wrapCryptoError(err: unknown): never {
  if (err instanceof CryptoError) {
    throw new DomainError("internal_error", err.message, { crypto_code: err.code });
  }
  throw err;
}

/**
 * Validate the provider-specific config. Each provider has a different
 * required key:
 *   - github  → config.repo ("owner/name")
 *   - plane   → config.workspace_slug
 *   - linear  → config.team_key
 *   - markdown → no required config (export-only provider)
 */
function validateProviderConfig(
  provider: IntegrationProvider,
  config: { repo?: string; workspace_slug?: string; team_key?: string; [key: string]: unknown } | undefined,
): void {
  if (!config) throw new ValidationError("config is required");
  switch (provider) {
    case "github":
      if (!config.repo?.trim()) throw new ValidationError("config.repo is required");
      break;
    case "plane":
      if (!config.workspace_slug?.trim()) {
        throw new ValidationError("config.workspace_slug is required");
      }
      break;
    case "linear":
      if (!config.team_key?.trim()) {
        throw new ValidationError("config.team_key is required");
      }
      break;
    case "markdown":
      // Export-only — no required config.
      break;
  }
}

export const integrationService: IntegrationService = {
  async create(db, actor, workspaceId, input) {
    if (!input.name?.trim()) throw new ValidationError("name is required");
    validateProviderConfig(input.provider, input.config);

    let storedConfig: Record<string, unknown>;
    try {
      storedConfig = encryptConfig(input.provider, input.config);
    } catch (err) {
      wrapCryptoError(err);
    }

    const id = crypto.randomUUID();
    const configJson = JSON.stringify(storedConfig);
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
            config: stripSecrets(input.provider, input.config),
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

  async getDecryptedConfig(db, workspaceId, id, opts) {
    const row = await db.first<Record<string, unknown>>(
      "SELECT * FROM integrations WHERE id = ? AND workspace_id = ?",
      [id, workspaceId],
    );
    if (!row) return null;
    const provider = row.provider as IntegrationProvider;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(row.config_json as string) as Record<string, unknown>;
    } catch {
      throw new DomainError("internal_error", "integration config_json is corrupt");
    }
    let config: Record<string, unknown>;
    try {
      config = decryptConfig(provider, parsed, opts);
    } catch (err) {
      wrapCryptoError(err);
    }
    return { provider, config };
  },

  async update(db, actor, workspaceId, id, patch) {
    const existing = await integrationService.get(db, workspaceId, id);
    if (!existing) throw new NotFoundError("integration", id);

    const sets: string[] = [];
    const params: SqlBindValue[] = [];
    let nextConfig: Record<string, unknown> | undefined;

    if (patch.name !== undefined) {
      if (!patch.name.trim()) throw new ValidationError("name cannot be empty");
      sets.push("name = ?");
      params.push(patch.name);
    }
    if (patch.config !== undefined) {
      let stored: Record<string, unknown>;
      try {
        stored = encryptConfig(existing.provider, patch.config);
      } catch (err) {
        wrapCryptoError(err);
      }
      nextConfig = patch.config;
      sets.push("config_json = ?");
      params.push(JSON.stringify(stored));
    }
    if (patch.status !== undefined) {
      sets.push("status = ?");
      params.push(patch.status);
    }
    if (sets.length === 0) return existing;

    params.push(id);
    params.push(workspaceId);

    const existingParsed = JSON.parse(existing.configJson) as Record<string, unknown>;
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
            config: stripSecrets(existing.provider, existingParsed),
          },
          after: {
            id,
            name: patch.name ?? existing.name,
            config: nextConfig ? stripSecrets(existing.provider, nextConfig) : undefined,
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

    const existingParsed = JSON.parse(existing.configJson) as Record<string, unknown>;
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
            config: stripSecrets(existing.provider, existingParsed),
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

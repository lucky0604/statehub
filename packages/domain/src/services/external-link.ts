/**
 * External link service — tie a StateHub entity to an external resource
 * (PR URL, issue URL, etc.).
 *
 * Source: agent_flow/implementation/v1/phases/phase-06-import-integration.md
 *         §4.3 (external_links), §3 principle 3 (every imported entity
 *         stores external_source and external_id), §3 principle 5 (imports
 *         are idempotent).
 *
 * P06A scope: manual link creation (e.g. user pastes a PR URL on a feature).
 * The import mappers (Plane/Linear/GitHub Issues) land in P06B/P06C and
 * will route through this same service.
 *
 * Idempotency: the (workspace_id, entity_type, entity_id, external_source,
 * external_id) UNIQUE constraint plus a pre-check make `create` idempotent —
 * re-linking the same PR returns the existing row rather than throwing.
 */
import {
  type DbClient,
  type ActorContext,
  type ExternalLink,
  type ExternalSource,
  type SqlBindValue,
  withEvent,
} from "@statehub/db";
import { mapExternalLink } from "../mappers";
import { NotFoundError, ValidationError } from "../errors";

export interface ExternalLinkService {
  create(
    db: DbClient,
    actor: ActorContext,
    workspaceId: string,
    input: CreateExternalLinkInput,
  ): Promise<ExternalLink>;
  list(
    db: DbClient,
    workspaceId: string,
    filter?: {
      projectId?: string;
      entityType?: string;
      entityId?: string;
      externalSource?: ExternalSource;
    },
  ): Promise<ExternalLink[]>;
  get(db: DbClient, workspaceId: string, linkId: string): Promise<ExternalLink | null>;
  remove(db: DbClient, actor: ActorContext, workspaceId: string, linkId: string): Promise<void>;
}

export interface CreateExternalLinkInput {
  projectId?: string;
  entityType: string;
  entityId: string;
  externalSource: ExternalSource;
  externalId: string;
  externalUrl: string;
}

const ENTITY_TYPES = ["project", "feature", "work_item", "review_finding", "evidence", "decision"] as const;
type EntityType = (typeof ENTITY_TYPES)[number];

function isEntityType(t: string): t is EntityType {
  return (ENTITY_TYPES as readonly string[]).includes(t);
}

async function ensureEntityExists(
  db: DbClient,
  workspaceId: string,
  entityType: string,
  entityId: string,
): Promise<void> {
  if (!isEntityType(entityType)) {
    throw new ValidationError(
      `entity_type must be one of: ${ENTITY_TYPES.join(", ")}`,
    );
  }
  // Some tables soft-delete (deleted_at), some don't (decisions, evidence
  // are append-only). Build the WHERE clause accordingly.
  const tableByType: Record<EntityType, { table: string; softDelete: boolean }> = {
    project: { table: "projects", softDelete: true },
    feature: { table: "features", softDelete: true },
    work_item: { table: "work_items", softDelete: true },
    review_finding: { table: "review_findings", softDelete: true },
    evidence: { table: "evidence", softDelete: false },
    decision: { table: "decisions", softDelete: false },
  };
  const { table, softDelete } = tableByType[entityType];
  const sql = softDelete
    ? `SELECT id FROM ${table} WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`
    : `SELECT id FROM ${table} WHERE id = ? AND workspace_id = ?`;
  const row = await db.first<{ id: string }>(sql, [entityId, workspaceId]);
  if (!row) throw new NotFoundError(entityType, entityId);
}

export const externalLinkService: ExternalLinkService = {
  async create(db, actor, workspaceId, input) {
    if (!input.entityType?.trim()) {
      throw new ValidationError("entity_type is required");
    }
    if (!input.entityId?.trim()) {
      throw new ValidationError("entity_id is required");
    }
    if (!input.externalId?.trim()) {
      throw new ValidationError("external_id is required");
    }
    if (!input.externalUrl?.trim()) {
      throw new ValidationError("external_url is required");
    }
    try {
      new URL(input.externalUrl);
    } catch {
      throw new ValidationError("external_url must be a valid URL");
    }

    await ensureEntityExists(db, workspaceId, input.entityType, input.entityId);

    // Idempotency: return the existing link if one already ties this entity
    // to the same external resource. Avoids UNIQUE-violation round-trips for
    // the common "user clicks Link twice" case.
    const existing = await db.first<{ id: string }>(
      `SELECT id FROM external_links
       WHERE workspace_id = ? AND entity_type = ? AND entity_id = ?
         AND external_source = ? AND external_id = ?`,
      [
        workspaceId,
        input.entityType,
        input.entityId,
        input.externalSource,
        input.externalId,
      ],
    );
    if (existing) {
      const row = await db.first<Record<string, unknown>>(
        "SELECT * FROM external_links WHERE id = ?",
        [existing.id],
      );
      if (!row) throw new Error("external_link vanished after idempotency check");
      return mapExternalLink(row);
    }

    const id = crypto.randomUUID();
    const params: SqlBindValue[] = [
      id,
      workspaceId,
      input.projectId ?? null,
      input.entityType,
      input.entityId,
      input.externalSource,
      input.externalId,
      input.externalUrl,
      "linked",
      null,
      actor.id ?? null,
    ];

    await withEvent(
      db,
      {
        workspaceId,
        projectId: input.projectId,
        entityType: "external_link",
        entityId: id,
        eventType: "external_link.created",
        actor,
        source: actor.type === "user" ? "user" : actor.type,
        payload: {
          linkedEntityType: input.entityType,
          linkedEntityId: input.entityId,
          externalSource: input.externalSource,
          externalId: input.externalId,
          externalUrl: input.externalUrl,
        },
      },
      () => [
        {
          sql: `INSERT INTO external_links
            (id, workspace_id, project_id, entity_type, entity_id,
             external_source, external_id, external_url, sync_status,
             last_synced_at, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          params,
        },
      ],
    );

    const row = await db.first<Record<string, unknown>>(
      "SELECT * FROM external_links WHERE id = ?",
      [id],
    );
    if (!row) throw new Error("external_link insert failed");
    return mapExternalLink(row);
  },

  async list(db, workspaceId, filter) {
    const conditions = ["workspace_id = ?"];
    const params: SqlBindValue[] = [workspaceId];
    if (filter?.projectId) {
      conditions.push("project_id = ?");
      params.push(filter.projectId);
    }
    if (filter?.entityType) {
      conditions.push("entity_type = ?");
      params.push(filter.entityType);
    }
    if (filter?.entityId) {
      conditions.push("entity_id = ?");
      params.push(filter.entityId);
    }
    if (filter?.externalSource) {
      conditions.push("external_source = ?");
      params.push(filter.externalSource);
    }
    const sql = `SELECT * FROM external_links WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC`;
    const rows = await db.all<Record<string, unknown>>(sql, params);
    return rows.map(mapExternalLink);
  },

  async get(db, workspaceId, linkId) {
    const row = await db.first<Record<string, unknown>>(
      "SELECT * FROM external_links WHERE id = ? AND workspace_id = ?",
      [linkId, workspaceId],
    );
    return row ? mapExternalLink(row) : null;
  },

  async remove(db, actor, workspaceId, linkId) {
    const link = await externalLinkService.get(db, workspaceId, linkId);
    if (!link) throw new NotFoundError("external_link", linkId);

    await withEvent(
      db,
      {
        workspaceId,
        projectId: link.projectId ?? undefined,
        entityType: "external_link",
        entityId: linkId,
        eventType: "external_link.removed",
        actor,
        source: actor.type === "user" ? "user" : actor.type,
        payload: {
          linkedEntityType: link.entityType,
          linkedEntityId: link.entityId,
          externalSource: link.externalSource,
          externalId: link.externalId,
        },
      },
      () => [
        {
          sql: "DELETE FROM external_links WHERE id = ? AND workspace_id = ?",
          params: [linkId, workspaceId] as SqlBindValue[],
        },
      ],
    );
  },
};

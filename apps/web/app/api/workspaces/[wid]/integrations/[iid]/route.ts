/**
 * GET /api/workspaces/:wid/integrations/:iid — get a single integration.
 * PATCH /api/workspaces/:wid/integrations/:iid — update name/config/status.
 * DELETE /api/workspaces/:wid/integrations/:iid — remove an integration.
 *
 * Source: agent_flow/implementation/v1/phases/phase-06-import-integration.md §4.1
 */
import {
  integrationService,
  type IntegrationStatus,
} from "@statehub/domain";
import { withEnvelope, parseBody, param } from "@/lib/api-handler";
import { db, getActor } from "@/lib/server";

export const runtime = "nodejs";

export const GET = withEnvelope(async (_req, params) => {
  const wid = param(params, "wid");
  const iid = param(params, "iid");
  const integration = await integrationService.get(db(), wid, iid);
  return { integration };
});

export const PATCH = withEnvelope(async (req, params) => {
  const wid = param(params, "wid");
  const iid = param(params, "iid");
  const body = await parseBody<{
    name?: string;
    config?: { repo?: string; pat?: string; [key: string]: unknown };
    status?: string;
  }>(req);
  const patch: {
    name?: string;
    config?: { repo?: string; pat?: string; [key: string]: unknown };
    status?: IntegrationStatus;
  } = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.config !== undefined) patch.config = body.config;
  if (body.status !== undefined) patch.status = body.status as IntegrationStatus;
  const integration = await integrationService.update(
    db(),
    getActor(),
    wid,
    iid,
    patch,
  );
  return { integration };
});

export const DELETE = withEnvelope(async (_req, params) => {
  const wid = param(params, "wid");
  const iid = param(params, "iid");
  await integrationService.remove(db(), getActor(), wid, iid);
  return { id: iid, deleted: true };
});

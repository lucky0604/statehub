/**
 * GET /api/workspaces/:wid/integrations — list integrations.
 * POST /api/workspaces/:wid/integrations — create a new integration.
 *
 * List query params: provider?
 *
 * Source: agent_flow/implementation/v1/phases/phase-06-import-integration.md §4.1
 */
import {
  integrationService,
  type IntegrationProvider,
} from "@statehub/domain";
import { withEnvelope, parseBody, param, query, required } from "@/lib/api-handler";
import { db, getActor } from "@/lib/server";

export const runtime = "nodejs";

export const GET = withEnvelope(async (req, params) => {
  const wid = param(params, "wid");
  const q = query(req);
  const filter: { provider?: IntegrationProvider } = {};
  if (q.provider) filter.provider = q.provider as IntegrationProvider;
  const integrations = await integrationService.list(db(), wid, filter);
  return { integrations };
});

export const POST = withEnvelope(async (req, params) => {
  const wid = param(params, "wid");
  const body = await parseBody<{
    provider?: string;
    name?: string;
    config?: { repo?: string; pat?: string; [key: string]: unknown };
  }>(req);
  const integration = await integrationService.create(
    db(),
    getActor(),
    wid,
    {
      provider: required(body.provider, "provider") as IntegrationProvider,
      name: required(body.name, "name"),
      config: required(body.config, "config"),
    },
  );
  return { integration_id: integration.id, integration };
});

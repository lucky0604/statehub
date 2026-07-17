/**
 * GET /api/workspaces/:wid/import-jobs — list import jobs.
 *
 * Query params: integration_id?, limit?
 *
 * Source: agent_flow/implementation/v1/phases/phase-06-import-integration.md §4.2
 */
import { listImportJobs } from "@statehub/domain";
import { withEnvelope, param, query } from "@/lib/api-handler";
import { db } from "@/lib/server";

export const runtime = "nodejs";

export const GET = withEnvelope(async (req, params) => {
  const wid = param(params, "wid");
  const q = query(req);
  const filter: { integrationId?: string; limit?: number } = {};
  if (q.integration_id) filter.integrationId = q.integration_id;
  if (q.limit) {
    const n = Number(q.limit);
    if (!Number.isNaN(n) && n > 0) filter.limit = n;
  }
  const jobs = await listImportJobs(db(), wid, filter);
  return { jobs };
});

/**
 * GET /api/workspaces/:wid/import-jobs/:jobId — get a single import job.
 *
 * Source: agent_flow/implementation/v1/phases/phase-06-import-integration.md §4.2
 */
import { getImportJob } from "@statehub/domain";
import { withEnvelope, param } from "@/lib/api-handler";
import { db } from "@/lib/server";

export const runtime = "nodejs";

export const GET = withEnvelope(async (_req, params) => {
  const wid = param(params, "wid");
  const jobId = param(params, "jobId");
  const job = await getImportJob(db(), wid, jobId);
  return { job };
});

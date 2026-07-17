/**
 * POST /api/workspaces/:wid/integrations/:iid/import/run — run an import.
 * Creates work items + external_links + an import_job row.
 *
 * Dispatches to the right importer based on the integration's provider:
 * github → githubIssuesImporter, plane → planeIssuesImporter,
 * linear → linearIssuesImporter.
 *
 * Body: { project_id, state_id, issues: any[] }  (shape depends on provider)
 *
 * Source: agent_flow/implementation/v1/phases/phase-06-import-integration.md §5
 */
import { resolveImporter } from "@/lib/import-dispatch";
import { withEnvelope, parseBody, param, required } from "@/lib/api-handler";
import { db, getActor } from "@/lib/server";

export const runtime = "nodejs";

export const POST = withEnvelope(async (req, params) => {
  const wid = param(params, "wid");
  const iid = param(params, "iid");
  const body = await parseBody<{
    project_id?: string;
    state_id?: string;
    issues?: unknown[];
  }>(req);
  const { importer } = await resolveImporter(db(), wid, iid);
  const result = await importer.run(db(), getActor(), wid, iid, {
    projectId: required(body.project_id, "project_id"),
    stateId: required(body.state_id, "state_id"),
    issues: required(body.issues, "issues"),
  });
  return { job_id: result.jobId, result };
});

/**
 * POST /api/workspaces/:wid/integrations/:iid/import/preview — preview
 * the work items that would be created from a list of external issues.
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
import { db } from "@/lib/server";

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
  const preview = await importer.preview(db(), wid, iid, {
    projectId: required(body.project_id, "project_id"),
    stateId: required(body.state_id, "state_id"),
    issues: required(body.issues, "issues"),
  });
  return { preview };
});

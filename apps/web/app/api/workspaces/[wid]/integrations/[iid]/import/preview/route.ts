/**
 * POST /api/workspaces/:wid/integrations/:iid/import/preview — preview
 * the work items that would be created from a list of GitHub issues.
 *
 * Body: { project_id, state_id, issues: GithubIssue[] }
 *
 * Source: agent_flow/implementation/v1/phases/phase-06-import-integration.md §5.2
 */
import { githubIssuesImporter, type GithubIssue } from "@statehub/domain";
import { withEnvelope, parseBody, param, required } from "@/lib/api-handler";
import { db } from "@/lib/server";

export const runtime = "nodejs";

export const POST = withEnvelope(async (req, params) => {
  const wid = param(params, "wid");
  const iid = param(params, "iid");
  const body = await parseBody<{
    project_id?: string;
    state_id?: string;
    issues?: GithubIssue[];
  }>(req);
  const preview = await githubIssuesImporter.preview(db(), wid, iid, {
    projectId: required(body.project_id, "project_id"),
    stateId: required(body.state_id, "state_id"),
    issues: required(body.issues, "issues"),
  });
  return { preview };
});

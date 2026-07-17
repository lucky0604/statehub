/**
 * GET /api/workspaces/:wid/export/markdown — generate a markdown export of
 * workspace state (or a single project, if ?project_id= is provided).
 *
 * Query params: project_id?, include_reviews?, include_evidence?
 *
 * Source: agent_flow/implementation/v1/phases/phase-06-import-integration.md §5.4
 */
import { exportProject } from "@statehub/domain";
import { withEnvelope, param, query } from "@/lib/api-handler";
import { db } from "@/lib/server";

export const runtime = "nodejs";

function parseFlag(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined) return fallback;
  return v === "1" || v === "true" || v === "yes";
}

export const GET = withEnvelope(async (req, params) => {
  const wid = param(params, "wid");
  const q = query(req);
  const result = await exportProject(
    db(),
    wid,
    {
      projectId: q.project_id || undefined,
      includeReviews: parseFlag(q.include_reviews, true),
      includeEvidence: parseFlag(q.include_evidence, true),
    },
  );
  return {
    markdown: result.markdown,
    generated_at: result.generatedAt,
    byte_length: result.byteLength,
    project_ids: result.projectIds,
  };
});

import { reviewService, workItemService } from "@statehub/domain";
import { withEnvelope, param } from "@/lib/api-handler";
import { db } from "@/lib/server";

export const runtime = "nodejs";

/**
 * GET /api/workspaces/:wid/projects/:pid/work-items/:wiid/findings
 *
 * Returns findings linked to this work item (via linked_work_item_id) AND
 * findings targeting this work item (via work_item_id). Feeds the Work Item
 * Peek findings section.
 *
 * Returns:
 *   { findings: ReviewFinding[], linkedWorkItems: Array<{id, identifier, projectId}> }
 *
 * `linkedWorkItems` contains the work items referenced by `linked_work_item_id`
 * across the returned findings, so the client can resolve identifiers without
 * a second round-trip per finding.
 */
export const GET = withEnvelope(async (_req, params) => {
  const wid = param(params, "wid");
  const wiid = param(params, "wiid");
  const findings = await reviewService.listFindingsForWorkItem(db(), wid, wiid);

  const linkedIds = new Set<string>();
  for (const f of findings) {
    if (f.linkedWorkItemId) linkedIds.add(f.linkedWorkItemId);
  }
  const linkedWorkItems: Array<{ id: string; identifier: string; projectId: string }> = [];
  for (const id of linkedIds) {
    const wi = await workItemService.get(db(), wid, id);
    if (wi) {
      linkedWorkItems.push({
        id: wi.id,
        identifier: `${wi.projectIdentifier}-${wi.sequenceId}`,
        projectId: wi.projectId,
      });
    }
  }

  return { findings, linkedWorkItems };
});

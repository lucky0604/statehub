import { notFound } from "next/navigation";

import {
  requireWorkspace,
  getProject,
  listStates,
  listLabels,
  listFeatures,
  listWorkItems,
  listViews,
  listWorkItemLabelIds,
} from "@/lib/queries";
import { buildFilterFromUrl } from "@/lib/work-items-url";
import { WorkItemsSurface } from "@/components/work-items/work-items-surface";

/**
 * Work Items surface — the project's primary view.
 *
 * One data path: buildFilterFromUrl() turns the URL query into a single filter,
 * and the same filter feeds both List and Kanban (phase-01 risk #2 mitigation).
 * Peek is a client overlay driven by ?peek=<id>; the list stays mounted so
 * scroll/context is preserved.
 *
 * URL state (§3.3): layout, view, state[], priority[], label[], feature,
 * source[], confidence[], search, peek, group, sort.
 */
export default async function WorkItemsPage({
  params,
  searchParams,
}: {
  params: Promise<{ wid: string; pid: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { wid, pid } = await params;
  const ws = await requireWorkspace();
  if (ws.id !== wid) notFound();

  const project = await getProject(wid, pid);
  if (!project) notFound();

  const search = await searchParams;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(search)) {
    if (typeof v === "string") qs.set(k, v);
    else if (Array.isArray(v)) for (const item of v) qs.append(k, item);
  }

  // Same filter for List and Kanban.
  const filter = buildFilterFromUrl(qs);

  const [states, labels, features, views, items] = await Promise.all([
    listStates(wid, pid),
    listLabels(wid, pid),
    listFeatures(wid, pid),
    listViews(wid, pid),
    listWorkItems(wid, pid, filter),
  ]);

  // Per-work-item label ids (for card/list label chips).
  const labelIdsByItem = await Promise.all(
    items.map(async (wi) => [wi.id, await listWorkItemLabelIds(wid, wi.id)] as const),
  );
  const labelMap = new Map(labelIdsByItem);

  return (
    <WorkItemsSurface
      workspaceId={wid}
      projectId={pid}
      states={states}
      labels={labels}
      features={features}
      views={views}
      items={items}
      labelIdsByItem={labelMap}
      currentSearch={qs.toString()}
    />
  );
}

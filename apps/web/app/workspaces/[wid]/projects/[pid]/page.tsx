import Link from "next/link";
import { notFound } from "next/navigation";

import {
  requireWorkspace,
  getProject,
  listStates,
  listWorkItems,
} from "@/lib/queries";
import { StatusBadge } from "@/components/status-badge";

/**
 * Work items list — the project's primary surface.
 *
 * URL-backed filters: ?status_group=&state_id=&priority=&type=&search=
 * (URL state wiring is P01A-QA; this page renders the filterable list.)
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

  const states = await listStates(wid, pid);
  const stateById = new Map(states.map((s) => [s.id, s]));

  const search = await searchParams;
  const filter: Parameters<typeof listWorkItems>[2] = {};
  const sg = search.status_group;
  if (typeof sg === "string") filter.statusGroup = sg as (typeof filter)["statusGroup"];
  if (typeof search.state_id === "string") filter.stateId = search.state_id;
  if (typeof search.priority === "string") filter.priority = search.priority as (typeof filter)["priority"];
  if (typeof search.type === "string") filter.type = search.type as (typeof filter)["type"];
  if (typeof search.search === "string") filter.search = search.search;

  const items = await listWorkItems(wid, pid, filter);

  return (
    <div className="px-5 py-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[14px] font-semibold text-txt-primary">
          Work Items
          <span className="ml-2 text-[12px] font-normal text-txt-tertiary">
            {items.length}
          </span>
        </h2>
      </div>

      {items.length === 0 ? (
        <div className="rounded-md border border-border-subtle bg-surface-1 p-8 text-center text-[13px] text-txt-tertiary">
          No work items match the current filters.
        </div>
      ) : (
        <ul className="divide-y divide-border-subtle rounded-md border border-border-subtle bg-surface-1">
          {items.map((wi) => {
            const state = wi.stateId ? stateById.get(wi.stateId) : undefined;
            return (
              <li key={wi.id}>
                <Link
                  href={`/workspaces/${wid}/projects/${pid}/work-items/${wi.id}`}
                  className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2"
                >
                  <span className="w-16 shrink-0 font-mono-app text-[11px] text-txt-tertiary">
                    {wi.projectIdentifier}-{wi.sequenceId}
                  </span>
                  <StatusBadge group={wi.statusGroup} />
                  <span className="flex-1 truncate text-[13px] text-txt-primary">
                    {wi.title}
                  </span>
                  {state ? (
                    <span className="text-[11px] text-txt-secondary">
                      {state.name}
                    </span>
                  ) : null}
                  <span className="text-[11px] capitalize text-txt-tertiary">
                    {wi.priority}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

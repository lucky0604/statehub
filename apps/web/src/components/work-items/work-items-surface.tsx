"use client";

import { useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import type {
  State,
  Label,
  Feature,
  WorkItem,
  View,
} from "@statehub/domain";
import { Toolbar } from "./toolbar";
import { WorkItemList } from "./work-item-list";
import { KanbanBoard } from "./kanban-board";
import { PeekDrawer } from "./peek-drawer";
import { layoutFromUrl, peekIdFromUrl, type UrlState } from "@/lib/work-items-url";

interface Props {
  workspaceId: string;
  projectId: string;
  states: State[];
  labels: Label[];
  features: Feature[];
  views: View[];
  items: WorkItem[];
  labelIdsByItem: Map<string, string[]>;
  currentSearch: string;
}

/**
 * Client orchestrator for the Work Items surface.
 *
 * Reads layout + peek from the URL. Renders Toolbar, then List or Kanban, then
 * Peek as an overlay. Keeping list/kanban mounted under the overlay preserves
 * scroll when Peek opens (§10.3 rule 1).
 */
export function WorkItemsSurface({
  workspaceId,
  projectId,
  states,
  labels,
  features,
  views,
  items,
  labelIdsByItem,
  currentSearch,
}: Props) {
  // currentSearch is the initial URL string — used to hydrate the toolbar's
  // search input. Kept as a prop so SSR + first paint match.
  void currentSearch;
  const router = useRouter();
  const searchParams = useSearchParams();

  const state: UrlState = useMemo(() => {
    const out: UrlState = {};
    for (const key of searchParams.keys()) {
      const all = searchParams.getAll(key);
      out[key] = all.length > 1 ? all : (all[0] ?? "");
    }
    return out;
  }, [searchParams]);

  const layout = layoutFromUrl(state);
  const peekId = peekIdFromUrl(state);

  /** Patch the URL query, preserving unset keys. */
  const patchQuery = useCallback(
    (patch: Record<string, string | string[] | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) {
          next.delete(k);
        } else if (Array.isArray(v)) {
          next.delete(k);
          for (const item of v) next.append(k, item);
        } else {
          next.set(k, v);
        }
      }
      router.replace(`/workspaces/${workspaceId}/projects/${projectId}?${next.toString()}`, {
        scroll: false,
      });
    },
    [router, searchParams, workspaceId, projectId],
  );

  const closePeek = useCallback(() => {
    patchQuery({ peek: null });
  }, [patchQuery]);

  const openPeek = useCallback(
    (id: string) => {
      patchQuery({ peek: id });
    },
    [patchQuery],
  );

  const setLayout = useCallback(
    (l: "list" | "kanban") => {
      patchQuery({ layout: l });
    },
    [patchQuery],
  );

  return (
    <div className="flex h-full flex-col">
      <Toolbar
        workspaceId={workspaceId}
        projectId={projectId}
        states={states}
        labels={labels}
        features={features}
        views={views}
        layout={layout}
        searchParams={searchParams}
        onLayoutChange={setLayout}
        onPatchQuery={patchQuery}
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        {layout === "kanban" ? (
          <KanbanBoard
            workspaceId={workspaceId}
            projectId={projectId}
            states={states}
            labels={labels}
            features={features}
            items={items}
            labelIdsByItem={labelIdsByItem}
            onOpenPeek={openPeek}
          />
        ) : (
          <WorkItemList
            workspaceId={workspaceId}
            projectId={projectId}
            states={states}
            labels={labels}
            features={features}
            items={items}
            labelIdsByItem={labelIdsByItem}
            onOpenPeek={openPeek}
          />
        )}
      </div>
      {peekId ? (
        <PeekDrawer
          workspaceId={workspaceId}
          projectId={projectId}
          workItemId={peekId}
          states={states}
          labels={labels}
          features={features}
          onClose={closePeek}
          onPatchQuery={patchQuery}
        />
      ) : null}
    </div>
  );
}

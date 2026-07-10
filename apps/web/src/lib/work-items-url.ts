/**
 * Shared URL → work-items filter builder.
 *
 * List and Kanban MUST read from the same filter object so filters can't drift
 * (phase-01 risk #2). Both surfaces call this helper with the current URL state.
 *
 * Source: agent_flow/implementation/v1/phases/phase-01...md §4.4, §4.5
 *         packages/shared/src/url-state.ts (URL_STATE_KEYS)
 */
import type { ListWorkItemsFilter, Priority, StatusGroup, WorkItemSource, ConfidenceLevel } from "@statehub/domain";
import { parseUrlState } from "@statehub/shared";

export type UrlState = Partial<Record<string, string | string[]>>;

/** Collect a repeatable key into a typed string[]. */
function arr(state: UrlState, key: string): string[] {
  const v = state[key];
  if (Array.isArray(v)) return v;
  if (typeof v === "string") return [v];
  return [];
}

/**
 * Build a ListWorkItemsFilter from the URL search params.
 * `search` is the raw query string (e.g. from request.url or window.location.search).
 */
export function buildFilterFromUrl(search: string | URLSearchParams): ListWorkItemsFilter {
  const state = parseUrlState(search);
  const filter: ListWorkItemsFilter = {};

  const stateIds = arr(state, "state");
  if (stateIds.length > 0) filter.stateIds = stateIds;

  const statusGroups = arr(state, "status_group") as StatusGroup[];
  if (statusGroups.length > 0) filter.statusGroups = statusGroups;

  const priorities = arr(state, "priority") as Priority[];
  if (priorities.length > 0) filter.priorities = priorities;

  const labelIds = arr(state, "label");
  if (labelIds.length > 0) filter.labelIds = labelIds;

  const sources = arr(state, "source") as WorkItemSource[];
  if (sources.length > 0) filter.sources = sources;

  const confidences = arr(state, "confidence") as ConfidenceLevel[];
  if (confidences.length > 0) filter.confidences = confidences;

  if (typeof state.feature === "string") {
    // "null" is the URL encoding of "no feature" (matches the API route's
    // translation in work-items/route.ts). Translate to a real NULL filter so
    // both the SSR page and the API list path agree (P01B review: H1).
    filter.featureId = state.feature === "null" ? null : state.feature;
  }
  if (typeof state.cycle === "string") void state.cycle; // reserved
  if (typeof state.search === "string") filter.search = state.search;

  return filter;
}

/** Resolve the layout from URL state, defaulting to "list". */
export function layoutFromUrl(state: UrlState): "list" | "kanban" {
  return state.layout === "kanban" ? "kanban" : "list";
}

/** Resolve the peek work-item id from URL state, or null. */
export function peekIdFromUrl(state: UrlState): string | null {
  return typeof state.peek === "string" && state.peek ? state.peek : null;
}

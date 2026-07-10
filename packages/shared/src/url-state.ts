/**
 * URL state helpers for Work Item views.
 *
 * Source: agent_flow/implementation/v1/phases/phase-00-foundation.md §3.5
 *         agent_flow/statehub-design-system.md §3.3
 *
 * These keys live in the URL query string so refresh + share restore the view.
 * P00 ships parse/serialize stubs. P01A wires them into Work Items List/Kanban/Peek.
 */

export const URL_STATE_KEYS = [
  "layout", // "list" | "kanban"
  "view", // saved view id
  "state", // state id filter (repeatable)
  "priority", // priority filter (repeatable)
  "label", // label filter (repeatable)
  "feature", // feature id filter
  "cycle", // cycle id filter
  "source", // source filter (repeatable)
  "confidence", // confidence filter (repeatable)
  "search", // text search
  "group", // group-by field
  "sort", // sort field + direction
  "peek", // open work item id
  "panel", // right-rail panel: "ai" | "evidence" | "review"
  "page", // pagination cursor
] as const;

export type UrlStateKey = (typeof URL_STATE_KEYS)[number];

/**
 * Parse a URLSearchParams into a typed URL state object.
 * Repeatable keys (state, priority, label, source, confidence) collect into arrays.
 */
export function parseUrlState(
  search: URLSearchParams | string,
): Partial<Record<UrlStateKey, string | string[]>> {
  const params =
    typeof search === "string" ? new URLSearchParams(search) : search;
  const out: Partial<Record<UrlStateKey, string | string[]>> = {};

  const repeatable = new Set<UrlStateKey>([
    "state",
    "priority",
    "label",
    "source",
    "confidence",
  ]);

  for (const key of URL_STATE_KEYS) {
    if (repeatable.has(key)) {
      const all = params.getAll(key);
      if (all.length > 0) out[key] = all;
    } else {
      const v = params.get(key);
      if (v !== null) out[key] = v;
    }
  }

  return out;
}

/**
 * Serialize a URL state object back into a URLSearchParams.
 * Array values expand to repeated keys.
 */
export function serializeUrlState(
  state: Partial<Record<UrlStateKey, string | string[]>>,
): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of URL_STATE_KEYS) {
    const v = state[key];
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      for (const item of v) params.append(key, item);
    } else {
      params.set(key, v);
    }
  }
  return params;
}

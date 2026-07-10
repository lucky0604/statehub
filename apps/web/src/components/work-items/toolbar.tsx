"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { List, KanbanSquare, Save, Filter, X, Search } from "lucide-react";

import type { State, Label, Feature, View, StatusGroup, Priority } from "@statehub/domain";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api-client";

interface Props {
  workspaceId: string;
  projectId: string;
  states: State[];
  labels: Label[];
  features: Feature[];
  views: View[];
  layout: "list" | "kanban";
  searchParams: URLSearchParams;
  onLayoutChange: (l: "list" | "kanban") => void;
  onPatchQuery: (patch: Record<string, string | string[] | null>) => void;
}

const STATUS_GROUP_OPTIONS: { value: StatusGroup; label: string }[] = [
  { value: "backlog", label: "Backlog" },
  { value: "unstarted", label: "Todo" },
  { value: "started", label: "In Progress" },
  { value: "completed", label: "Done" },
  { value: "cancelled", label: "Dropped" },
];

const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
  { value: "none", label: "None" },
];

/** Read a repeatable query value into a Set. */
function querySet(sp: URLSearchParams, key: string): Set<string> {
  return new Set(sp.getAll(key));
}

/**
 * Toolbar (§9.3): layout switcher, saved view selector, filter, search.
 * Height 44px. Filters write to the URL via onPatchQuery.
 */
export function Toolbar({
  workspaceId,
  projectId,
  states,
  labels,
  features,
  views,
  layout,
  searchParams,
  onLayoutChange,
  onPatchQuery,
}: Props) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const [, startTransition] = useTransition();

  const activeState = querySet(searchParams, "state");
  const activeStatus = querySet(searchParams, "status_group");
  const activePriority = querySet(searchParams, "priority");
  const activeLabel = querySet(searchParams, "label");
  const activeFeature = searchParams.get("feature");
  const searchValue = searchParams.get("search") ?? "";

  const hasActiveFilters =
    activeState.size + activeStatus.size + activePriority.size + activeLabel.size > 0 ||
    activeFeature !== null ||
    searchValue !== "";

  /** Toggle a value in a repeatable filter key. */
  function toggle(key: string, value: string) {
    const current = new Set(searchParams.getAll(key));
    if (current.has(value)) current.delete(value);
    else current.add(value);
    onPatchQuery({ [key]: [...current] });
  }

  function setSingle(key: string, value: string | null) {
    onPatchQuery({ [key]: value });
  }

  function clearFilters() {
    onPatchQuery({
      state: null,
      status_group: null,
      priority: null,
      label: null,
      feature: null,
      search: null,
    });
  }

  async function saveView() {
    setError(null);
    if (!saveName.trim()) return;
    setSaving(true);
    try {
      // Build the view query from the current URL filters.
      const query: Record<string, unknown> = {};
      const stateIds = searchParams.getAll("state");
      const status = searchParams.getAll("status_group");
      const priorities = searchParams.getAll("priority");
      const labelIds = searchParams.getAll("label");
      if (stateIds.length) query.stateIds = stateIds;
      if (status.length) query.statusGroups = status;
      if (priorities.length) query.priorities = priorities;
      if (labelIds.length) query.labelIds = labelIds;
      if (searchParams.get("feature")) query.featureId = searchParams.get("feature");
      if (searchParams.get("search")) query.search = searchParams.get("search");

      await api.post<View>(
        `/api/workspaces/${workspaceId}/projects/${projectId}/views`,
        {
          name: saveName.trim(),
          layout,
          query,
        },
      );
      setSaveOpen(false);
      setSaveName("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save view");
    } finally {
      setSaving(false);
    }
  }

  function applyView(view: View) {
    // Apply the view: set layout + write its filters into the URL.
    setViewMenuOpen(false);
    startTransition(() => {
      const next = new URLSearchParams();
      next.set("layout", view.layout);
      next.set("view", view.id);
      // Re-encode the view's stored query into URL params.
      try {
        const q = JSON.parse(view.queryJson) as Record<string, unknown>;
        if (Array.isArray(q.stateIds)) for (const s of q.stateIds) next.append("state", String(s));
        if (Array.isArray(q.statusGroups)) for (const s of q.statusGroups) next.append("status_group", String(s));
        if (Array.isArray(q.priorities)) for (const p of q.priorities) next.append("priority", String(p));
        if (Array.isArray(q.labelIds)) for (const l of q.labelIds) next.append("label", String(l));
        if (typeof q.featureId === "string") next.set("feature", q.featureId);
        if (typeof q.search === "string") next.set("search", q.search);
      } catch {
        // invalid stored query — apply layout only
      }
      router.replace(
        `/workspaces/${workspaceId}/projects/${projectId}?${next.toString()}`,
        { scroll: false },
      );
    });
  }

  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border-subtle bg-surface-1 px-3">
      {/* Layout switcher */}
      <div className="flex items-center rounded-md border border-border-subtle bg-surface-2">
        <button
          type="button"
          onClick={() => onLayoutChange("list")}
          aria-pressed={layout === "list"}
          aria-label="List layout"
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-l-md transition-colors",
            layout === "list" ? "bg-layer-2 text-txt-primary" : "text-txt-tertiary hover:text-txt-primary",
          )}
        >
          <List className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onLayoutChange("kanban")}
          aria-pressed={layout === "kanban"}
          aria-label="Kanban layout"
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-r-md transition-colors",
            layout === "kanban" ? "bg-layer-2 text-txt-primary" : "text-txt-tertiary hover:text-txt-primary",
          )}
        >
          <KanbanSquare className="h-4 w-4" />
        </button>
      </div>

      {/* Saved view selector */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setViewMenuOpen((v) => !v)}
          className="flex h-7 items-center gap-1.5 rounded-md border border-border-subtle bg-surface-2 px-2.5 text-[12px] text-txt-secondary hover:text-txt-primary"
        >
          <Filter className="h-3.5 w-3.5" />
          Views
          <span className="text-txt-tertiary">({views.length})</span>
        </button>
        {viewMenuOpen ? (
          <div className="absolute left-0 top-8 z-20 w-56 rounded-md border border-border-subtle bg-surface-1 py-1 shadow-lg">
            {views.length === 0 ? (
              <div className="px-3 py-2 text-[12px] text-txt-tertiary">No saved views</div>
            ) : (
              views.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => applyView(v)}
                  className="flex w-full items-center justify-between px-3 py-1.5 text-[12px] text-txt-primary hover:bg-surface-2"
                >
                  <span className="truncate">{v.name}</span>
                  <span className="text-[10px] uppercase text-txt-tertiary">{v.layout}</span>
                </button>
              ))
            )}
          </div>
        ) : null}
      </div>

      {/* Filter button */}
      <button
        type="button"
        onClick={() => setFilterOpen((v) => !v)}
        aria-pressed={filterOpen}
        className={cn(
          "flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[12px]",
          hasActiveFilters
            ? "border-accent/40 bg-accent/10 text-accent"
            : "border-border-subtle bg-surface-2 text-txt-secondary hover:text-txt-primary",
        )}
      >
        <Filter className="h-3.5 w-3.5" />
        Filter
        {hasActiveFilters ? <span className="text-[10px]">●</span> : null}
      </button>

      {hasActiveFilters ? (
        <button
          type="button"
          onClick={clearFilters}
          className="flex h-7 items-center gap-1 rounded-md px-1.5 text-[11px] text-txt-tertiary hover:text-txt-primary"
        >
          <X className="h-3 w-3" />
          Clear
        </button>
      ) : null}

      {/* Search */}
 <div className="relative ml-1">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-txt-tertiary" />
        <input
          type="search"
          defaultValue={searchValue}
          aria-label="Search work items"
          placeholder="Search..."
          onChange={(e) => setSingle("search", e.target.value || null)}
          className="h-7 w-44 rounded-md border border-border-subtle bg-surface-2 pl-7 pr-2 text-[12px] text-txt-primary placeholder:text-txt-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
        />
      </div>

      <div className="flex-1" />

      {/* Save view */}
      {saveOpen ? (
        <div className="flex items-center gap-1.5">
          <input
            autoFocus
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="View name"
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveView();
              if (e.key === "Escape") setSaveOpen(false);
            }}
            className="h-7 w-36 rounded-md border border-border-subtle bg-surface-2 px-2 text-[12px] text-txt-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
          />
          <button
            type="button"
            onClick={() => void saveView()}
            disabled={saving}
            className="h-7 rounded-md bg-accent px-2 text-[12px] text-on-accent disabled:opacity-50"
          >
            {saving ? "…" : "Save"}
          </button>
          {error ? <span className="text-[11px] text-danger">{error}</span> : null}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setSaveOpen(true)}
          className="flex h-7 items-center gap-1.5 rounded-md border border-border-subtle bg-surface-2 px-2.5 text-[12px] text-txt-secondary hover:text-txt-primary"
        >
          <Save className="h-3.5 w-3.5" />
          Save view
        </button>
      )}

      {/* Filter popover */}
      {filterOpen ? (
        <div className="absolute left-3 top-12 z-20 w-72 rounded-md border border-border-subtle bg-surface-1 p-3 shadow-lg">
          <FilterSection title="Status group">
            {STATUS_GROUP_OPTIONS.map((opt) => (
              <FilterChip
                key={opt.value}
                label={opt.label}
                active={activeStatus.has(opt.value)}
                onClick={() => toggle("status_group", opt.value)}
              />
            ))}
          </FilterSection>
          <FilterSection title="State">
            {states.map((s) => (
              <FilterChip
                key={s.id}
                label={s.name}
                active={activeState.has(s.id)}
                onClick={() => toggle("state", s.id)}
              />
            ))}
          </FilterSection>
          <FilterSection title="Priority">
            {PRIORITY_OPTIONS.map((opt) => (
              <FilterChip
                key={opt.value}
                label={opt.label}
                active={activePriority.has(opt.value)}
                onClick={() => toggle("priority", opt.value)}
              />
            ))}
          </FilterSection>
          <FilterSection title="Label">
            {labels.map((l) => (
              <FilterChip
                key={l.id}
                label={l.name}
                active={activeLabel.has(l.id)}
                onClick={() => toggle("label", l.id)}
              />
            ))}
          </FilterSection>
          <FilterSection title="Feature">
            <FilterChip
              label="No feature"
              active={activeFeature === "null"}
              onClick={() => setSingle("feature", activeFeature === "null" ? null : "null")}
            />
            {features.map((f) => (
              <FilterChip
                key={f.id}
                label={f.name}
                active={activeFeature === f.id}
                onClick={() => setSingle("feature", activeFeature === f.id ? null : f.id)}
              />
            ))}
          </FilterSection>
        </div>
      ) : null}
    </div>
  );
}

function FilterSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-2 last:mb-0">
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-txt-tertiary">
        {title}
      </div>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-xs border px-1.5 py-0.5 text-[11px] transition-colors",
        active
          ? "border-accent/50 bg-accent/15 text-accent"
          : "border-border-subtle bg-surface-2 text-txt-secondary hover:text-txt-primary",
      )}
    >
      {label}
    </button>
  );
}

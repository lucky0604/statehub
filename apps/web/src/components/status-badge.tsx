import type { StatusGroup } from "@statehub/domain";

const GROUP_LABELS: Record<StatusGroup, string> = {
  backlog: "Backlog",
  unstarted: "Todo",
  started: "In Progress",
  completed: "Done",
  cancelled: "Dropped",
};

const GROUP_STYLES: Record<StatusGroup, string> = {
  backlog: "bg-layer-2 text-txt-secondary",
  unstarted: "bg-surface-2 text-txt-secondary border border-border-subtle",
  started: "bg-accent/10 text-accent",
  completed: "bg-success/15 text-success",
  cancelled: "bg-danger/10 text-danger",
};

/**
 * Status badge — color-coded by status_group. The denormalized group on each
 * work item drives the color so we don't join to states for the list view.
 */
export function StatusBadge({ group }: { group: StatusGroup }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-xs px-1.5 py-0.5 text-[11px] font-medium ${GROUP_STYLES[group]}`}
    >
      {GROUP_LABELS[group]}
    </span>
  );
}

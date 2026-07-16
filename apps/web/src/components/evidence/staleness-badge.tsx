import type { EvidenceStalenessState } from "@statehub/domain";

/**
 * Staleness badge — fresh / stale / unknown. Visual only; the underlying
 * computation lives in the domain ( staleness_state column on evidence).
 */
const STALENESS_LABELS: Record<EvidenceStalenessState, string> = {
  fresh: "Fresh",
  stale: "Stale",
  unknown: "Freshness unknown",
};

const STALENESS_STYLES: Record<EvidenceStalenessState, string> = {
  fresh: "bg-success/10 text-success",
  stale: "bg-warning/15 text-warning",
  unknown: "bg-layer-2 text-txt-tertiary",
};

export function StalenessBadge({ state }: { state: EvidenceStalenessState }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-xs px-1.5 py-0.5 text-[10px] font-medium ${STALENESS_STYLES[state]}`}
      title={STALENESS_LABELS[state]}
    >
      {STALENESS_LABELS[state]}
    </span>
  );
}

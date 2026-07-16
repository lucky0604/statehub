import type { EvidenceTrustState } from "@statehub/domain";

/**
 * Evidence trust badge — color-coded by how much we believe the evidence.
 *
 * Source: agent_flow/implementation/v1/phases/phase-02-minimum-agent-sync-loop.md §6.2
 *         agent_flow/statehub-design-system.md §11.5
 *
 *   trusted      — git-verified (Phase 04 local sidecar) → green
 *   working_tree — agent-submitted, matches a working tree → amber, striped
 *   untrusted    — agent-submitted, unverifiable → red
 *   unknown      — not yet assessed → gray
 */
const TRUST_LABELS: Record<EvidenceTrustState, string> = {
  trusted: "Trusted",
  working_tree: "Working tree",
  untrusted: "Untrusted",
  unknown: "Unverified",
};

const TRUST_STYLES: Record<EvidenceTrustState, string> = {
  trusted: "bg-success/15 text-success",
  working_tree:
    "bg-warning/15 text-warning [background-image:repeating-linear-gradient(45deg,transparent,transparent_4px,rgba(0,0,0,0.06)_4px,rgba(0,0,0,0.06)_6px)]",
  untrusted: "bg-danger/15 text-danger",
  unknown: "bg-layer-2 text-txt-tertiary",
};

export function EvidenceTrustBadge({ state }: { state: EvidenceTrustState }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-xs px-1.5 py-0.5 text-[10px] font-medium ${TRUST_STYLES[state]}`}
      title={`Trust: ${TRUST_LABELS[state]}`}
    >
      {TRUST_LABELS[state]}
    </span>
  );
}

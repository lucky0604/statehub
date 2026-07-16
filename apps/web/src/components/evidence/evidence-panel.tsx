import type { Evidence } from "@statehub/domain";
import { EvidenceTrustBadge } from "./evidence-trust-badge";
import { StalenessBadge } from "./staleness-badge";

/**
 * Evidence Panel — list of structured proof attached to a feature / work item /
 * agent run. Read-only in P02C; the trust + staleness markers are the headline
 * visual (design system §11.5).
 *
 * Source: agent_flow/implementation/v1/phases/phase-02-minimum-agent-sync-loop.md §6.2
 */
interface Props {
  evidence: Evidence[];
  /** When true (e.g. empty list), render the "no evidence" state. */
  emptyHint?: string;
}

const TYPE_LABELS: Record<Evidence["evidenceType"], string> = {
  agent_run: "Agent run",
  test_result: "Test result",
  file_change: "File change",
  command: "Command",
  commit: "Commit",
  manual_check: "Manual check",
  review_finding: "Review finding",
};

export function EvidencePanel({ evidence, emptyHint = "No evidence yet." }: Props) {
  if (evidence.length === 0) {
    return (
      <div className="rounded-md border border-border-subtle bg-surface-1 p-3">
        <div className="text-[11px] font-medium uppercase tracking-wide text-txt-tertiary">
          Evidence
        </div>
        <p className="mt-1.5 text-[12px] text-txt-tertiary italic">{emptyHint}</p>
      </div>
    );
  }

  return (
    <section
      className="rounded-md border border-border-subtle bg-surface-1 p-3"
      aria-label="Evidence"
      data-testid="evidence-panel"
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[11px] font-medium uppercase tracking-wide text-txt-tertiary">
          Evidence
        </div>
        <span className="text-[10px] text-txt-tertiary">{evidence.length} row(s)</span>
      </div>
      <ul className="space-y-2">
        {evidence.map((e) => (
          <li
            key={e.id}
            className="rounded-md border border-border-subtle bg-surface-2 px-3 py-2"
          >
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-xs bg-layer-2 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-txt-secondary">
                {TYPE_LABELS[e.evidenceType]}
              </span>
              <EvidenceTrustBadge state={e.trustState} />
              <StalenessBadge state={e.stalenessState} />
              <span className="ml-auto text-[10px] text-txt-tertiary">
                {new Date(e.createdAt).toLocaleString()}
              </span>
            </div>
            <div className="mt-1 text-[13px] font-medium text-txt-primary">{e.title}</div>
            {e.summary ? (
              <p className="mt-0.5 text-[12px] text-txt-secondary">{e.summary}</p>
            ) : null}
            {e.artifactUrl ? (
              <a
                href={e.artifactUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-block text-[11px] text-accent hover:underline"
              >
                artifact →
              </a>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

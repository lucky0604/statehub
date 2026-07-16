/**
 * LocalContextChip — surfaces git_context fields from a local-evidence row's
 * payload as small status chips: dirty working tree, stale test, repo unknown.
 *
 * Source: agent_flow/implementation/v1/iterations/20260716-p04c-ui-docs-e2e/plan.md §2.3
 *
 * The local sidecar (P04B) embeds `git_context` into evidence.payload_json
 * when it calls sync_evidence. We parse it here to derive the three chips.
 * If the payload doesn't have git_context (e.g. evidence submitted via the
 * remote MCP tools without local context), nothing renders.
 */
import type { Evidence } from "@statehub/domain";

interface ParsedGitContext {
  dirty_state?: boolean;
  match_status?: "matched" | "alias_matched" | "unknown";
}

function parseGitContext(payloadJson: string): ParsedGitContext | null {
  try {
    const parsed = JSON.parse(payloadJson) as { git_context?: ParsedGitContext };
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.git_context) return null;
    return parsed.git_context;
  } catch {
    return null;
  }
}

interface Props {
  evidence: Evidence;
  /** Staleness is already on the row via StalenessBadge — passed here so the
   * "stale test" warning chip only renders alongside the existing badge. */
  stalenessState?: Evidence["stalenessState"];
}

export function LocalContextChip({ evidence, stalenessState }: Props) {
  const ctx = parseGitContext(evidence.payloadJson);
  if (!ctx) return null;

  const chips: Array<{ label: string; className: string; testId: string }> = [];

  if (ctx.dirty_state === true) {
    chips.push({
      label: "Dirty working tree",
      className: "bg-amber-100 text-amber-900 border-amber-200",
      testId: "chip-dirty",
    });
  }
  if (stalenessState === "stale") {
    chips.push({
      label: "Stale test",
      className: "bg-amber-100 text-amber-900 border-amber-200",
      testId: "chip-stale-test",
    });
  }
  if (ctx.match_status === "unknown") {
    chips.push({
      label: "Repo unknown",
      className: "bg-layer-2 text-txt-secondary border-border-subtle",
      testId: "chip-repo-unknown",
    });
  }

  if (chips.length === 0) return null;

  return (
    <>
      {chips.map((c) => (
        <span
          key={c.testId}
          data-testid={c.testId}
          className={`rounded-xs border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${c.className}`}
        >
          {c.label}
        </span>
      ))}
    </>
  );
}

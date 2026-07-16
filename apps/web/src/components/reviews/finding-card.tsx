"use client";

import Link from "next/link";
import type { ReviewFinding, FindingSeverity, FindingStatus } from "@statehub/domain";
import { cn } from "@/lib/cn";
import { FindingActions } from "./finding-actions";

/**
 * Finding Card — server component rendering one review finding.
 *
 * Source: agent_flow/implementation/v1/iterations/20260716-p03c-ui-e2e-docs/plan.md §2.2
 *
 * Severity dot + title + status + file:line + description + suggestion +
 * linked work item identifier. Actions are a separate client component so the
 * mutation can call the API and refresh the route.
 */
interface Props {
  workspaceId: string;
  projectId: string;
  reviewId: string;
  finding: ReviewFinding;
  /** Optional pre-resolved identifier (e.g. "STH-12") for the linked work item. */
  linkedIdentifier?: string;
  /** Optional href to the linked work item's project board. */
  linkedHref?: string;
}

const SEVERITY_DOT: Record<FindingSeverity, string> = {
  blocker: "bg-danger",
  high: "bg-warning",
  medium: "bg-amber-500",
  low: "bg-accent",
  nit: "bg-txt-tertiary",
};

const SEVERITY_LABEL: Record<FindingSeverity, string> = {
  blocker: "Blocker",
  high: "High",
  medium: "Medium",
  low: "Low",
  nit: "Nit",
};

const STATUS_STYLE: Record<FindingStatus, string> = {
  open: "bg-layer-2 text-txt-secondary",
  accepted: "bg-accent/15 text-accent",
  fixed: "bg-success/15 text-success",
  dismissed: "bg-layer-2 text-txt-tertiary line-through",
  wontfix: "bg-layer-2 text-txt-tertiary line-through",
  reopened: "bg-warning/15 text-warning",
};

export function FindingCard({
  workspaceId,
  projectId,
  reviewId,
  finding,
  linkedIdentifier,
  linkedHref,
}: Props) {
  const fileLine =
    finding.filePath != null
      ? finding.lineStart != null
        ? `${finding.filePath}:${finding.lineStart}${finding.lineEnd != null ? `-${finding.lineEnd}` : ""}`
        : finding.filePath
      : null;

  return (
    <article
      className="rounded-md border border-border-subtle bg-surface-1 p-3"
      data-testid="finding-card"
      data-finding-id={finding.id}
      data-severity={finding.severity}
      data-status={finding.status}
    >
      <div className="flex items-start gap-2">
        <span
          className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", SEVERITY_DOT[finding.severity])}
          aria-label={`severity: ${SEVERITY_LABEL[finding.severity]}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-medium text-txt-primary">{finding.title}</span>
            <span
              className={cn(
                "rounded-xs px-1.5 py-0.5 text-[10px] font-medium capitalize",
                STATUS_STYLE[finding.status],
              )}
            >
              {finding.status}
            </span>
            <span className="text-[10px] uppercase tracking-wide text-txt-tertiary">
              {SEVERITY_LABEL[finding.severity]}
            </span>
          </div>

          {fileLine ? (
            <div className="mt-0.5 font-mono-app text-[11px] text-txt-tertiary">{fileLine}</div>
          ) : null}

          {finding.description ? (
            <p className="mt-1.5 text-[12px] leading-relaxed text-txt-secondary">
              {finding.description}
            </p>
          ) : null}

          {finding.suggestion ? (
            <blockquote className="mt-1.5 border-l-2 border-accent/40 bg-accent/5 px-2.5 py-1.5 text-[12px] italic text-txt-secondary">
              {finding.suggestion}
            </blockquote>
          ) : null}

          {linkedIdentifier ? (
            <div className="mt-1.5 text-[11px] text-txt-tertiary">
              linked fix:{" "}
              {linkedHref ? (
                <Link href={linkedHref} className="font-mono-app text-accent hover:underline">
                  {linkedIdentifier}
                </Link>
              ) : (
                <span className="font-mono-app text-txt-secondary">{linkedIdentifier}</span>
              )}
            </div>
          ) : null}
        </div>
      </div>

      <FindingActions
        workspaceId={workspaceId}
        projectId={projectId}
        reviewId={reviewId}
        findingId={finding.id}
        status={finding.status}
      />
    </article>
  );
}

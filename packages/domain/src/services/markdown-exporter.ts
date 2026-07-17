/**
 * Markdown exporter — walk a workspace's (or single project's) state into
 * a single deterministic markdown document.
 *
 * Source: agent_flow/implementation/v1/phases/phase-06-import-integration.md
 *         §5.4 (Markdown export), §8 acceptance #6 (Markdown export includes
 *         features, work items, reviews, evidence, decisions).
 *
 * Output structure (matches §5.4):
 *
 *   # <project name> (<identifier>)
 *   > portfolio_priority: P0 · status: active
 *   > exported: <iso timestamp>
 *
 *   ## Current Focus
 *   ## Features
 *   ## Open Work Items
 *   ## Review Findings
 *   ## Agent Runs
 *   ## Evidence
 *   ## Decisions
 *   ## Weekly Reviews
 *
 * Determinism: the body is stable for a given DB state — no timestamps
 * inside section bodies. Only the header `exported:` line changes per
 * invocation, and the e2e asserts on section substrings rather than the
 * full document.
 */
import type { DbClient } from "@statehub/db";
import { projectService } from "./project";
import { featureService } from "./feature";
import { workItemService } from "./work-item";
import { reviewService } from "./review";
import { agentRunService } from "./agent-run";
import { evidenceService } from "./evidence";
import { decisionService } from "./decision";
import { weeklyReviewService } from "./weekly-review";
import { externalLinkService } from "./external-link";

export interface MarkdownExportOptions {
  /** If omitted, export all projects in the workspace. */
  projectId?: string;
  includeEvidence?: boolean;
  includeReviews?: boolean;
}

export interface MarkdownExportResult {
  markdown: string;
  generatedAt: number;
  byteLength: number;
  projectIds: string[];
}

export async function exportProject(
  db: DbClient,
  workspaceId: string,
  options?: MarkdownExportOptions,
): Promise<MarkdownExportResult> {
  const generatedAt = Date.now();
  const includeEvidence = options?.includeEvidence ?? true;
  const includeReviews = options?.includeReviews ?? true;

  const allProjects = await projectService.list(db, workspaceId);
  const projects = options?.projectId
    ? allProjects.filter((p) => p.id === options.projectId)
    : allProjects;

  const sections: string[] = [];
  for (const project of projects) {
    const section = await renderProjectSection(db, workspaceId, project, {
      includeEvidence,
      includeReviews,
    });
    sections.push(section);
  }

  const markdown = sections.join("\n\n---\n\n");
  return {
    markdown,
    generatedAt,
    byteLength: markdown.length,
    projectIds: projects.map((p) => p.id),
  };
}

async function renderProjectSection(
  db: DbClient,
  workspaceId: string,
  project: { id: string; name: string; identifier: string; status: string; portfolioPriority: string | null; description: string | null },
  opts: { includeEvidence: boolean; includeReviews: boolean },
): Promise<string> {
  const lines: string[] = [];
  const exportedAtIso = new Date().toISOString();

  lines.push(`# ${project.name} (${project.identifier})`);
  lines.push("");
  lines.push(`> portfolio_priority: ${project.portfolioPriority ?? "none"} · status: ${project.status}`);
  lines.push(`> exported: ${exportedAtIso}`);
  if (project.description) {
    lines.push(`> ${project.description}`);
  }
  lines.push("");

  // Current Focus — latest user-recorded decision on this project.
  const decisions = await decisionService.list(db, workspaceId, { projectId: project.id });
  const userDecisions = decisions.filter((d) => d.source === "user");
  const focus = userDecisions[0];
  lines.push("## Current Focus");
  lines.push("");
  if (focus) {
    lines.push(focus.decisionText);
    if (focus.rationale) lines.push(`_rationale: ${focus.rationale}_`);
  } else {
    lines.push("_No explicit focus recorded._");
  }
  lines.push("");

  // Features.
  const features = await featureService.list(db, workspaceId, project.id);
  lines.push("## Features");
  lines.push("");
  if (features.length === 0) {
    lines.push("_No features._");
  } else {
    for (const f of features) {
      lines.push(`### ${f.name} — ${f.status}`);
      if (f.description) lines.push(`_ ${f.description}`);
      lines.push("");
    }
  }
  lines.push("");

  // Open work items (exclude completed/cancelled).
  const workItems = await workItemService.list(db, workspaceId, project.id, {});
  const openItems = workItems.filter(
    (wi) => wi.statusGroup !== "completed" && wi.statusGroup !== "cancelled",
  );
  lines.push("## Open Work Items");
  lines.push("");
  if (openItems.length === 0) {
    lines.push("_No open work items._");
  } else {
    for (const wi of openItems) {
      const externalLinks = await externalLinkService.list(db, workspaceId, {
        entityType: "work_item",
        entityId: wi.id,
      });
      const seq = `${wi.projectIdentifier}-${wi.sequenceId}`;
      lines.push(
        `- [${seq}] ${wi.title} (state: ${wi.statusGroup}, priority: ${wi.priority})`,
      );
      for (const link of externalLinks) {
        lines.push(`  - external: [${link.externalSource}] ${link.externalUrl}`);
      }
    }
  }
  lines.push("");

  // Review findings (if enabled).
  if (opts.includeReviews) {
    const reviews = await reviewService.listForProject(db, workspaceId, project.id, 50);
    const allFindings: Array<{ severity: string; title: string; status: string; reviewId: string }> = [];
    for (const r of reviews) {
      const f = await reviewService.listFindings(db, workspaceId, r.id);
      for (const finding of f) {
        allFindings.push({
          severity: finding.severity,
          title: finding.title,
          status: finding.status,
          reviewId: r.id,
        });
      }
    }
    lines.push("## Review Findings");
    lines.push("");
    if (allFindings.length === 0) {
      lines.push("_No review findings._");
    } else {
      // Sort by severity: high > blocker > medium > low.
      const sevRank: Record<string, number> = { blocker: 0, high: 1, medium: 2, low: 3 };
      allFindings.sort((a, b) => (sevRank[a.severity] ?? 9) - (sevRank[b.severity] ?? 9));
      for (const f of allFindings) {
        const reviewShort = f.reviewId.slice(0, 8);
        lines.push(
          `- [${f.severity}] ${f.title} (review: ${reviewShort}, status: ${f.status})`,
        );
      }
    }
    lines.push("");
  }

  // Agent runs.
  const runs = await agentRunService.listForProject(db, workspaceId, project.id, 50);
  lines.push("## Agent Runs");
  lines.push("");
  if (runs.length === 0) {
    lines.push("_No agent runs._");
  } else {
    for (const r of runs) {
      const idShort = r.id.slice(0, 8);
      const summary = (r as { summary?: string | null }).summary ?? "(no summary)";
      lines.push(
        `- ${idShort} ${r.agent} ${r.runType} ${r.status} — ${summary}`,
      );
    }
  }
  lines.push("");

  // Evidence (if enabled) — iterate features.
  if (opts.includeEvidence) {
    lines.push("## Evidence");
    lines.push("");
    const allEvidence: Array<{ title: string; summary: string | null; trustState: string; stalenessState: string; id: string }> = [];
    for (const f of features) {
      const ev = await evidenceService.listForFeature(db, workspaceId, f.id);
      for (const e of ev) {
        allEvidence.push({
          title: e.title,
          summary: e.summary,
          trustState: e.trustState,
          stalenessState: e.stalenessState,
          id: e.id,
        });
      }
    }
    if (allEvidence.length === 0) {
      lines.push("_No evidence._");
    } else {
      for (const e of allEvidence) {
        lines.push(
          `- ${e.title} (trust: ${e.trustState}, stale: ${e.stalenessState})`,
        );
        if (e.summary) lines.push(`  ${e.summary}`);
        const links = await externalLinkService.list(db, workspaceId, {
          entityType: "evidence",
          entityId: e.id,
        });
        for (const link of links) {
          lines.push(`  - external: [${link.externalSource}] ${link.externalUrl}`);
        }
      }
    }
    lines.push("");
  }

  // Decisions.
  lines.push("## Decisions");
  lines.push("");
  if (decisions.length === 0) {
    lines.push("_No decisions recorded._");
  } else {
    for (const d of decisions) {
      const dateIso = new Date(d.createdAt).toISOString().slice(0, 10);
      lines.push(`- ${d.decisionText} (source: ${d.source}, ${dateIso})`);
      if (d.rationale) lines.push(`  rationale: ${d.rationale}`);
    }
  }
  lines.push("");

  // Weekly reviews.
  const weeklyReviews = await weeklyReviewService.list(db, workspaceId, { projectId: project.id });
  lines.push("## Weekly Reviews");
  lines.push("");
  if (weeklyReviews.length === 0) {
    lines.push("_No weekly reviews._");
  } else {
    for (const wr of weeklyReviews) {
      const weekStartIso = new Date(wr.weekStart).toISOString().slice(0, 10);
      lines.push(`### Week of ${weekStartIso}`);
      try {
        const summary = JSON.parse(wr.summaryJson) as Record<string, unknown>;
        if (typeof summary.completed === "number") lines.push(`- completed: ${summary.completed}`);
        if (typeof summary.stalled === "number") lines.push(`- stalled: ${summary.stalled}`);
        if (Array.isArray(summary.open_risks)) {
          lines.push(`- open_risks: ${(summary.open_risks as unknown[]).join(", ") || "(none)"}`);
        }
        if (Array.isArray(summary.next_week_focus)) {
          lines.push(`- next_week_focus: ${(summary.next_week_focus as unknown[]).join(", ") || "(none)"}`);
        }
      } catch {
        lines.push(`_(unparseable summary: ${wr.summaryJson.slice(0, 80)})_`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

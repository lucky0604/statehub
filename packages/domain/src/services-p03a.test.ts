/**
 * P03A domain tests — reviewService.submit / transitionFinding /
 * dismissFinding / createFollowupFixes.
 *
 * Covers:
 *   - submit creates review + findings in one transaction
 *   - submit validates reviewer / verdict / finding.title
 *   - submit emits review.submitted + N finding.created events
 *   - transitionFinding allows the §6 state-machine transitions
 *   - transitionFinding rejects invalid transitions
 *   - dismissFinding requires a reason
 *   - createFollowupFixes creates one fix per blocker/high finding
 *   - createFollowupFixes skips medium/low/nit by default
 *   - createFollowupFixes is idempotent on re-run (already_linked)
 *   - createFollowupFixes rejects low/nit even when explicitly requested
 *
 * Same in-memory isolation pattern as the P02 suites.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { setDbClient, createInMemoryDb } from "@statehub/db/node";
import type { DbClient } from "@statehub/db";
import {
  SOLO_ACTOR,
  remoteMcpActor,
  workspaceService,
  projectService,
  featureService,
  reviewService,
  ValidationError,
  NotFoundError,
} from "@statehub/domain";

describe("P03A reviewService.submit", () => {
  let db: DbClient;
  let wsId: string;
  let projectId: string;
  let featureId: string;

  beforeAll(async () => {
    db = createInMemoryDb();
    setDbClient(db);
    const ws = await workspaceService.create(db, SOLO_ACTOR, {
      slug: "p03a-ws",
      name: "P03A",
    });
    wsId = ws.id;
    const project = await projectService.create(db, SOLO_ACTOR, wsId, {
      slug: "proj",
      name: "P",
      identifier: "PSA",
    });
    projectId = project.id;
    const feature = await featureService.create(db, SOLO_ACTOR, wsId, projectId, {
      name: "P03A Feat",
      status: "in_progress",
    });
    featureId = feature.id;
  });

  it("creates a review + N findings in one submit", async () => {
    const actor = remoteMcpActor("codex", "tok-1");
    const result = await reviewService.submit(db, actor, wsId, {
      projectId,
      featureId,
      reviewer: "codex",
      model: "gpt-5",
      verdict: "needs_changes",
      summary: "Close but resume handling missing",
      findings: [
        { severity: "high", title: "Missing resume on auth flow", filePath: "src/auth.ts", lineStart: 42, lineEnd: 60 },
        { severity: "low", title: "Typo in error message", filePath: "src/auth.ts", lineStart: 100 },
      ],
    });
    expect(result.review.id).toMatch(/^[\w-]+$/);
    expect(result.review.verdict).toBe("needs_changes");
    expect(result.findings).toHaveLength(2);
    expect(result.findings[0]!.severity).toBe("high");
    expect(result.findings[0]!.status).toBe("open");
    expect(result.findings[0]!.version).toBe(1);
    expect(result.findings[1]!.severity).toBe("low");

    // Events: 1 review.submitted + 2 finding.created.
    const events = await db.all<{ event_type: string }>(
      "SELECT event_type FROM events WHERE workspace_id = ? AND entity_type IN ('review','finding') ORDER BY created_at ASC",
      [wsId],
    );
    const types = events.map((e) => e.event_type);
    expect(types).toContain("review.submitted");
    expect(types.filter((t) => t === "finding.created")).toHaveLength(2);
  });

  it("rejects submit with empty reviewer", async () => {
    const actor = remoteMcpActor("codex", "tok-2");
    await expect(
      reviewService.submit(db, actor, wsId, {
        projectId,
        featureId,
        reviewer: "",
        verdict: "approved",
        findings: [],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects submit with empty finding title", async () => {
    const actor = remoteMcpActor("codex", "tok-3");
    await expect(
      reviewService.submit(db, actor, wsId, {
        projectId,
        featureId,
        reviewer: "codex",
        verdict: "approved",
        findings: [{ severity: "high", title: "" }],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects submit with unknown project", async () => {
    const actor = remoteMcpActor("codex", "tok-4");
    await expect(
      reviewService.submit(db, actor, wsId, {
        projectId: "nonexistent",
        reviewer: "codex",
        verdict: "approved",
        findings: [],
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejects submit with unknown feature", async () => {
    const actor = remoteMcpActor("codex", "tok-5");
    await expect(
      reviewService.submit(db, actor, wsId, {
        projectId,
        featureId: "nonexistent",
        reviewer: "codex",
        verdict: "approved",
        findings: [],
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("listForFeature returns reviews ordered by created_at DESC", async () => {
    const actor = remoteMcpActor("codex", "tok-6");
    await reviewService.submit(db, actor, wsId, {
      projectId,
      featureId,
      reviewer: "codex",
      verdict: "informational",
      findings: [],
    });
    const list = await reviewService.listForFeature(db, wsId, featureId);
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list[0]!.createdAt).toBeGreaterThanOrEqual(list[1]!.createdAt);
  });
});

describe("P03A reviewService.transitionFinding + dismissFinding", () => {
  let db: DbClient;
  let wsId: string;
  let projectId: string;
  let featureId: string;
  let findingId: string;

  beforeAll(async () => {
    db = createInMemoryDb();
    setDbClient(db);
    const ws = await workspaceService.create(db, SOLO_ACTOR, {
      slug: "p03a-trans-ws",
      name: "P03A Trans",
    });
    wsId = ws.id;
    const project = await projectService.create(db, SOLO_ACTOR, wsId, {
      slug: "proj",
      name: "P",
      identifier: "PST",
    });
    projectId = project.id;
    const feature = await featureService.create(db, SOLO_ACTOR, wsId, projectId, {
      name: "Trans Feat",
      status: "in_progress",
    });
    featureId = feature.id;

    const actor = remoteMcpActor("codex", "tok-trans");
    const result = await reviewService.submit(db, actor, wsId, {
      projectId,
      featureId,
      reviewer: "codex",
      verdict: "needs_changes",
      findings: [{ severity: "high", title: "Open finding" }],
    });
    findingId = result.findings[0]!.id;
  });

  it("allows open → accepted", async () => {
    const actor = remoteMcpActor("user", "tok-acc");
    const f = await reviewService.transitionFinding(db, actor, wsId, findingId, {
      toStatus: "accepted",
    });
    expect(f.status).toBe("accepted");
    expect(f.version).toBe(2);
  });

  it("allows accepted → fixed", async () => {
    const actor = remoteMcpActor("user", "tok-fix");
    const f = await reviewService.transitionFinding(db, actor, wsId, findingId, {
      toStatus: "fixed",
    });
    expect(f.status).toBe("fixed");
  });

  it("rejects invalid transition fixed → accepted", async () => {
    const actor = remoteMcpActor("user", "tok-bad");
    await expect(
      reviewService.transitionFinding(db, actor, wsId, findingId, {
        toStatus: "accepted",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("allows fixed → reopened", async () => {
    const actor = remoteMcpActor("user", "tok-reopen");
    const f = await reviewService.transitionFinding(db, actor, wsId, findingId, {
      toStatus: "reopened",
    });
    expect(f.status).toBe("reopened");
  });

  it("dismissFinding requires a reason", async () => {
    // Get a fresh finding in 'open' state.
    const setupActor = remoteMcpActor("codex", "tok-dismiss");
    const result = await reviewService.submit(db, setupActor, wsId, {
      projectId,
      featureId,
      reviewer: "codex",
      verdict: "needs_changes",
      findings: [{ severity: "medium", title: "To dismiss" }],
    });
    const fid = result.findings[0]!.id;
    const actor = remoteMcpActor("user", "tok-d");

    await expect(
      reviewService.dismissFinding(db, actor, wsId, fid, ""),
    ).rejects.toBeInstanceOf(ValidationError);

    const dismissed = await reviewService.dismissFinding(db, actor, wsId, fid, "not actionable");
    expect(dismissed.status).toBe("dismissed");
    expect(dismissed.dismissedReason).toBe("not actionable");
    expect(dismissed.dismissedBy).toBe(actor.id);
  });

  it("emits finding.status_changed events on transition", async () => {
    const events = await db.all<{ event_type: string }>(
      "SELECT event_type FROM events WHERE workspace_id = ? AND event_type = 'finding.status_changed'",
      [wsId],
    );
    expect(events.length).toBeGreaterThan(0);
  });
});

describe("P03A reviewService.createFollowupFixes", () => {
  let db: DbClient;
  let wsId: string;
  let projectId: string;
  let featureId: string;
  let reviewId: string;

  beforeAll(async () => {
    db = createInMemoryDb();
    setDbClient(db);
    const ws = await workspaceService.create(db, SOLO_ACTOR, {
      slug: "p03a-fix-ws",
      name: "P03A Fix",
    });
    wsId = ws.id;
    const project = await projectService.create(db, SOLO_ACTOR, wsId, {
      slug: "proj",
      name: "P",
      identifier: "PSF",
    });
    projectId = project.id;
    const feature = await featureService.create(db, SOLO_ACTOR, wsId, projectId, {
      name: "Fix Feat",
      status: "in_progress",
    });
    featureId = feature.id;

    const actor = remoteMcpActor("codex", "tok-fix");
    const result = await reviewService.submit(db, actor, wsId, {
      projectId,
      featureId,
      reviewer: "codex",
      verdict: "needs_changes",
      findings: [
        { severity: "blocker", title: "Blocker finding" },
        { severity: "high", title: "High finding" },
        { severity: "medium", title: "Medium finding" },
        { severity: "low", title: "Low finding" },
      ],
    });
    reviewId = result.review.id;
  });

  it("creates fix items for blocker + high only (default severities)", async () => {
    const actor = remoteMcpActor("user", "tok-create");
    const result = await reviewService.createFollowupFixes(db, actor, wsId, {
      reviewId,
    });
    expect(result.createdFixes).toHaveLength(2);
    expect(result.createdFixes[0]!.severity).toBe("blocker");
    expect(result.createdFixes[1]!.severity).toBe("high");
    expect(result.createdFixes.every((c) => c.identifier.startsWith("PSF-"))).toBe(true);

    // medium + low should be skipped with severity_filtered.
    const filtered = result.skippedFindings.filter((s) => s.reason === "severity_filtered");
    expect(filtered.map((s) => s.severity).sort()).toEqual(["low", "medium"]);
  });

  it("re-running does not duplicate (already_linked)", async () => {
    const actor = remoteMcpActor("user", "tok-rerun");
    const result = await reviewService.createFollowupFixes(db, actor, wsId, {
      reviewId,
    });
    expect(result.createdFixes).toHaveLength(0);
    const alreadyLinked = result.skippedFindings.filter((s) => s.reason === "already_linked");
    expect(alreadyLinked).toHaveLength(2);
    expect(result.action).toBe("noop");
  });

  it("opting into medium creates a fix for the medium finding", async () => {
    // Use a fresh review with a medium finding not yet linked.
    const setupActor = remoteMcpActor("codex", "tok-med");
    const sub = await reviewService.submit(db, setupActor, wsId, {
      projectId,
      featureId,
      reviewer: "codex",
      verdict: "needs_changes",
      findings: [{ severity: "medium", title: "Medium only" }],
    });
    const actor = remoteMcpActor("user", "tok-med2");
    const result = await reviewService.createFollowupFixes(db, actor, wsId, {
      reviewId: sub.review.id,
      severities: ["medium"],
    });
    expect(result.createdFixes).toHaveLength(1);
    expect(result.createdFixes[0]!.severity).toBe("medium");
  });

  it("rejects low/nit even when explicitly requested", async () => {
    const actor = remoteMcpActor("user", "tok-low");
    await expect(
      reviewService.createFollowupFixes(db, actor, wsId, {
        reviewId,
        severities: ["low"],
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      reviewService.createFollowupFixes(db, actor, wsId, {
        reviewId,
        severities: ["nit"],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("emits finding.linked events for created fix items", async () => {
    const events = await db.all<{ event_type: string }>(
      "SELECT event_type FROM events WHERE workspace_id = ? AND event_type = 'finding.linked'",
      [wsId],
    );
    expect(events.length).toBeGreaterThan(0);
  });

  it("rejects createFollowupFixes for unknown review", async () => {
    const actor = remoteMcpActor("user", "tok-404");
    await expect(
      reviewService.createFollowupFixes(db, actor, wsId, {
        reviewId: "nonexistent",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

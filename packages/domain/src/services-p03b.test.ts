/**
 * P03B domain tests — Done Gate v1 (review-aware) + feature status automation.
 *
 * Covers:
 *   - Done Gate v1 result='blocked' when open blocker/high findings
 *   - Done Gate v1 result='blocked' when evidence trust_state is untrusted/unknown
 *   - Done Gate v1 result='warn' when evidence trust_state is working_tree
 *   - Done Gate v1 result='warn' when latest review verdict != approved
 *   - Done Gate v1 result='pass' when all items pass
 *   - Done Gate v1 checklist has the 8 typed items
 *   - reviewService.submit flips feature to needs_changes on verdict=needs_changes + high
 *   - reviewService.submit does NOT flip on verdict=approved
 *   - reviewService.submit is idempotent (no dup feature.status_changed event)
 */
import { describe, it, expect, beforeAll } from "vitest";
import { setDbClient, createInMemoryDb } from "@statehub/db/node";
import type { DbClient } from "@statehub/db";
import type {
  Feature,
  AgentRun,
  Evidence,
  Review,
  ReviewFinding,
} from "@statehub/db";
import {
  SOLO_ACTOR,
  remoteMcpActor,
  workspaceService,
  projectService,
  featureService,
  reviewService,
  doneGateService,
} from "@statehub/domain";

function feature(overrides: Partial<Feature> = {}): Feature {
  return {
    id: "f1",
    workspaceId: "ws",
    projectId: "p1",
    name: "F",
    description: null,
    status: "in_progress",
    sortOrder: 0,
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
    version: 1,
    createdBy: null,
    updatedBy: null,
    ...overrides,
  };
}

function run(overrides: Partial<AgentRun> = {}): AgentRun {
  return {
    id: "r1",
    workspaceId: "ws",
    projectId: "p1",
    featureId: "f1",
    workItemId: null,
    agent: "codex",
    model: "gpt-5",
    runType: "implement",
    status: "completed",
    summary: "did the thing",
    filesChangedJson: "[]",
    commandsRunJson: "[]",
    testResult: "all passing",
    commitSha: null,
    baseSha: null,
    headSha: null,
    gitBranch: null,
    dirtyState: null,
    repoRemoteUrl: null,
    risksJson: "[]",
    nextStepsJson: "[]",
    rawArtifactUrl: null,
    evidenceTrustState: "working_tree",
    startedAt: 1000,
    finishedAt: 2000,
    createdAt: 1000,
    updatedAt: 2000,
    deletedAt: null,
    version: 1,
    createdBy: null,
    updatedBy: null,
    ...overrides,
  };
}

function evidence(overrides: Partial<Evidence> = {}): Evidence {
  return {
    id: "e1",
    workspaceId: "ws",
    projectId: "p1",
    featureId: "f1",
    workItemId: null,
    agentRunId: "r1",
    evidenceType: "agent_run",
    title: "Evidence",
    summary: null,
    payloadJson: "{}",
    artifactUrl: null,
    trustState: "trusted",
    stalenessState: "fresh",
    createdAt: 2000,
    createdBy: null,
    ...overrides,
  };
}

function review(overrides: Partial<Review> = {}): Review {
  return {
    id: "rv1",
    workspaceId: "ws",
    projectId: "p1",
    featureId: "f1",
    workItemId: null,
    agentRunId: null,
    reviewer: "codex",
    model: "gpt-5",
    verdict: "approved",
    summary: null,
    confidence: "high",
    createdAt: 3000,
    updatedAt: 3000,
    deletedAt: null,
    version: 1,
    createdBy: null,
    updatedBy: null,
    ...overrides,
  };
}

function finding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    id: "fi1",
    workspaceId: "ws",
    reviewId: "rv1",
    projectId: "p1",
    featureId: "f1",
    workItemId: null,
    severity: "high",
    title: "Finding",
    description: null,
    filePath: null,
    lineStart: null,
    lineEnd: null,
    suggestion: null,
    status: "open",
    linkedWorkItemId: null,
    linkedTodoId: null,
    dismissedReason: null,
    dismissedBy: null,
    dismissedAt: null,
    createdAt: 3000,
    updatedAt: 3000,
    deletedAt: null,
    version: 1,
    createdBy: null,
    updatedBy: null,
    ...overrides,
  };
}

describe("P03B Done Gate v1 — review-aware", () => {
  it("returns result='blocked' when there are open blocker/high findings", () => {
    const s = doneGateService.summarize({
      feature: feature(),
      agentRuns: [run()],
      evidence: [evidence()],
      todos: [],
      reviews: [review({ verdict: "approved" })],
      findings: [
        finding({ severity: "blocker", status: "open" }),
        finding({ severity: "high", status: "open" }),
      ],
    });
    expect(s.result).toBe("blocked");
    expect(s.openBlockerHighCount).toBe(2);
    const item = s.checklist.find((c) => c.code === "no_open_blocker_high");
    expect(item?.status).toBe("blocked");
  });

  it("returns result='blocked' when evidence trust_state is untrusted", () => {
    const s = doneGateService.summarize({
      feature: feature(),
      agentRuns: [run()],
      evidence: [evidence({ trustState: "untrusted" })],
      todos: [],
      reviews: [review({ verdict: "approved" })],
      findings: [],
    });
    expect(s.result).toBe("blocked");
    const item = s.checklist.find((c) => c.code === "evidence_trusted");
    expect(item?.status).toBe("blocked");
  });

  it("returns result='blocked' when evidence trust_state is unknown", () => {
    const s = doneGateService.summarize({
      feature: feature(),
      agentRuns: [run()],
      evidence: [evidence({ trustState: "unknown" })],
      todos: [],
      reviews: [review({ verdict: "approved" })],
      findings: [],
    });
    expect(s.result).toBe("blocked");
  });

  it("returns result='warn' when evidence trust_state is working_tree", () => {
    const s = doneGateService.summarize({
      feature: feature(),
      agentRuns: [run()],
      evidence: [evidence({ trustState: "working_tree" })],
      todos: [],
      reviews: [review({ verdict: "approved" })],
      findings: [],
    });
    expect(s.result).toBe("warn");
    const item = s.checklist.find((c) => c.code === "evidence_trusted");
    expect(item?.status).toBe("warn");
  });

  it("returns result='warn' when latest review verdict is not approved", () => {
    const s = doneGateService.summarize({
      feature: feature(),
      agentRuns: [run()],
      evidence: [evidence()],
      todos: [],
      reviews: [review({ verdict: "needs_changes" })],
      findings: [],
    });
    expect(s.result).toBe("warn");
    const item = s.checklist.find((c) => c.code === "review_verdict_approved");
    expect(item?.status).toBe("warn");
  });

  it("returns result='pass' when all items pass (trusted evidence, approved, no findings)", () => {
    const s = doneGateService.summarize({
      feature: feature(),
      agentRuns: [run()],
      evidence: [evidence({ trustState: "trusted" })],
      todos: [],
      reviews: [review({ verdict: "approved" })],
      findings: [],
    });
    expect(s.result).toBe("pass");
    expect(s.checklist.every((c) => c.status === "pass")).toBe(true);
  });

  it("checklist has the 8 typed items", () => {
    const s = doneGateService.summarize({
      feature: feature(),
      agentRuns: [run()],
      evidence: [evidence()],
      todos: [],
      reviews: [review()],
      findings: [],
    });
    const codes = s.checklist.map((c) => c.code);
    expect(codes).toContain("completed_runs");
    expect(codes).toContain("test_result_recorded");
    expect(codes).toContain("evidence_linked");
    expect(codes).toContain("evidence_trusted");
    expect(codes).toContain("no_open_blocker_high");
    expect(codes).toContain("review_verdict_approved");
    expect(codes).toContain("open_todos");
    expect(codes).toContain("risks_reviewed");
  });

  it("does NOT count fixed/dismissed findings as open blocker/high", () => {
    const s = doneGateService.summarize({
      feature: feature(),
      agentRuns: [run()],
      evidence: [evidence()],
      todos: [],
      reviews: [review({ verdict: "approved" })],
      findings: [
        finding({ severity: "blocker", status: "fixed" }),
        finding({ severity: "high", status: "dismissed" }),
      ],
    });
    expect(s.openBlockerHighCount).toBe(0);
    expect(s.result).toBe("pass");
  });
});

describe("P03B reviewService.submit feature status automation", () => {
  let db: DbClient;
  let wsId: string;
  let projectId: string;
  let featureId: string;

  beforeAll(async () => {
    db = createInMemoryDb();
    setDbClient(db);
    const ws = await workspaceService.create(db, SOLO_ACTOR, {
      slug: "p03b-ws",
      name: "P03B",
    });
    wsId = ws.id;
    const project = await projectService.create(db, SOLO_ACTOR, wsId, {
      slug: "proj",
      name: "P",
      identifier: "PSB",
    });
    projectId = project.id;
    const feature = await featureService.create(db, SOLO_ACTOR, wsId, projectId, {
      name: "P03B Feat",
      status: "in_progress",
    });
    featureId = feature.id;
  });

  it("flips feature to needs_changes on verdict=needs_changes + high finding", async () => {
    const before = await featureService.get(db, wsId, featureId);
    expect(before?.status).toBe("in_progress");

    const actor = remoteMcpActor("codex", "tok-1");
    await reviewService.submit(db, actor, wsId, {
      projectId,
      featureId,
      reviewer: "codex",
      verdict: "needs_changes",
      findings: [{ severity: "high", title: "High finding" }],
    });

    const after = await featureService.get(db, wsId, featureId);
    expect(after?.status).toBe("needs_changes");

    const events = await db.all<{ event_type: string }>(
      "SELECT event_type FROM events WHERE workspace_id = ? AND event_type = 'feature.status_changed' AND entity_id = ?",
      [wsId, featureId],
    );
    expect(events.length).toBe(1);
  });

  it("does NOT flip feature on verdict=approved", async () => {
    // Use a fresh feature.
    const feature = await featureService.create(db, SOLO_ACTOR, wsId, projectId, {
      name: "Approved Feat",
      status: "in_progress",
    });
    const actor = remoteMcpActor("codex", "tok-2");
    await reviewService.submit(db, actor, wsId, {
      projectId,
      featureId: feature.id,
      reviewer: "codex",
      verdict: "approved",
      findings: [{ severity: "high", title: "High finding" }],
    });

    const after = await featureService.get(db, wsId, feature.id);
    expect(after?.status).toBe("in_progress");
  });

  it("does NOT flip feature on needs_changes without blocker/high", async () => {
    const feature = await featureService.create(db, SOLO_ACTOR, wsId, projectId, {
      name: "Medium Feat",
      status: "in_progress",
    });
    const actor = remoteMcpActor("codex", "tok-3");
    await reviewService.submit(db, actor, wsId, {
      projectId,
      featureId: feature.id,
      reviewer: "codex",
      verdict: "needs_changes",
      findings: [{ severity: "medium", title: "Medium finding" }],
    });

    const after = await featureService.get(db, wsId, feature.id);
    expect(after?.status).toBe("in_progress");
  });

  it("is idempotent — re-submitting needs_changes on already-needs_changes feature emits no dup event", async () => {
    const feature = await featureService.create(db, SOLO_ACTOR, wsId, projectId, {
      name: "Idempotent Feat",
      status: "in_progress",
    });
    const actor = remoteMcpActor("codex", "tok-4");
    await reviewService.submit(db, actor, wsId, {
      projectId,
      featureId: feature.id,
      reviewer: "codex",
      verdict: "needs_changes",
      findings: [{ severity: "blocker", title: "Blocker" }],
    });
    const after1 = await featureService.get(db, wsId, feature.id);
    expect(after1?.status).toBe("needs_changes");

    // Second review with same verdict — should not flip again.
    await reviewService.submit(db, actor, wsId, {
      projectId,
      featureId: feature.id,
      reviewer: "codex",
      verdict: "needs_changes",
      findings: [{ severity: "high", title: "Second high" }],
    });

    const events = await db.all<{ event_type: string }>(
      "SELECT event_type FROM events WHERE workspace_id = ? AND event_type = 'feature.status_changed' AND entity_id = ?",
      [wsId, feature.id],
    );
    expect(events.length).toBe(1);
  });
});

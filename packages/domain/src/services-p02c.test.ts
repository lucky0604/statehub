/**
 * P02C domain tests — Done Gate v0 + MCP sync derivation.
 *
 * Done Gate v0 (phase-02 §6.2.1) is warning-only. Every branch of
 * doneGateService.summarize is exercised. MCP sync derivation
 * (mcpSyncService.derive) is exercised against an in-memory DB seeded with
 * realistic token + agent_run rows.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { setDbClient, createInMemoryDb } from "@statehub/db/node";
import type { DbClient } from "@statehub/db";
import type {
  AgentRun,
  Evidence,
  Feature,
  Todo,
} from "@statehub/domain";
import {
  SOLO_ACTOR,
  workspaceService,
  projectService,
  tokenService,
  agentRunService,
  doneGateService,
  mcpSyncService,
} from "@statehub/domain";

/** Build a minimal feature-shaped object for the gate (pure-fn input). */
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
    agent: "opencode",
    model: null,
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
    title: "ev",
    summary: null,
    payloadJson: "{}",
    artifactUrl: null,
    trustState: "working_tree",
    stalenessState: "fresh",
    createdAt: 2000,
    createdBy: null,
    ...overrides,
  };
}

function todo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: "t1",
    workspaceId: "ws",
    projectId: "p1",
    featureId: "f1",
    workItemId: null,
    agentRunId: null,
    title: "T",
    description: null,
    status: "backlog",
    type: "implementation",
    priority: "none",
    source: "remote_mcp",
    confidence: "none",
    evidenceRequired: 0,
    evidenceSummary: null,
    sortOrder: 0,
    completedAt: null,
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
    version: 1,
    createdBy: null,
    updatedBy: null,
    ...overrides,
  };
}

describe("P02C DoneGateService.summarize", () => {
  it("warns 'no_completed_runs' when there are zero completed runs", () => {
    const s = doneGateService.summarize({
      feature: feature(),
      agentRuns: [run({ id: "r-running", status: "running", finishedAt: null })],
      evidence: [],
      todos: [],
    });
    expect(s.readyForReview).toBe(false);
    const codes = s.warnings.map((w) => w.code);
    expect(codes).toContain("no_completed_runs");
  });

  it("warns 'missing_test_result' when latest completed run has no test_result", () => {
    const s = doneGateService.summarize({
      feature: feature(),
      agentRuns: [run({ testResult: null })],
      evidence: [evidence()],
      todos: [],
    });
    expect(s.warnings.map((w) => w.code)).toContain("missing_test_result");
    expect(s.readyForReview).toBe(false);
  });

  it("warns 'missing_evidence' when latest completed run has no linked evidence", () => {
    const s = doneGateService.summarize({
      feature: feature(),
      agentRuns: [run()],
      evidence: [],
      todos: [],
    });
    expect(s.warnings.map((w) => w.code)).toContain("missing_evidence");
  });

  it("warns 'untrusted_evidence' when linked evidence is working_tree/unknown/untrusted", () => {
    const s = doneGateService.summarize({
      feature: feature(),
      agentRuns: [run()],
      evidence: [evidence({ trustState: "working_tree" }), evidence({ trustState: "unknown", id: "e2" })],
      todos: [],
    });
    expect(s.warnings.map((w) => w.code)).toContain("untrusted_evidence");
  });

  it("does NOT warn 'untrusted_evidence' when all evidence is 'trusted'", () => {
    const s = doneGateService.summarize({
      feature: feature(),
      agentRuns: [run()],
      evidence: [evidence({ trustState: "trusted" })],
      todos: [],
    });
    expect(s.warnings.map((w) => w.code)).not.toContain("untrusted_evidence");
  });

  it("warns 'open_todos' (info severity) when the feature has open todos", () => {
    const s = doneGateService.summarize({
      feature: feature(),
      agentRuns: [run()],
      evidence: [evidence({ trustState: "trusted" })],
      todos: [todo({ status: "in_progress" })],
    });
    const openTodoWarning = s.warnings.find((w) => w.code === "open_todos");
    expect(openTodoWarning).toBeDefined();
    expect(openTodoWarning!.severity).toBe("info");
  });

  it("readyForReview=true only when status=in_progress, ≥1 completed run, no warn-severity warnings", () => {
    const s = doneGateService.summarize({
      feature: feature({ status: "in_progress" }),
      agentRuns: [run({ testResult: "all passing" })],
      evidence: [evidence({ trustState: "trusted" })],
      todos: [],
    });
    expect(s.readyForReview).toBe(true);
    expect(s.blockingCount).toBe(0);
  });

  it("readyForReview=false when feature status is not 'in_progress'", () => {
    const s = doneGateService.summarize({
      feature: feature({ status: "needs_review" }),
      agentRuns: [run({ testResult: "all passing" })],
      evidence: [evidence({ trustState: "trusted" })],
      todos: [],
    });
    expect(s.readyForReview).toBe(false);
  });

  it("picks the latest completed run by finished_at desc", () => {
    const earlier = run({ id: "r-early", finishedAt: 1000, testResult: "ok" });
    const latest = run({ id: "r-late", finishedAt: 5000, testResult: null });
    const s = doneGateService.summarize({
      feature: feature(),
      agentRuns: [earlier, latest],
      evidence: [evidence({ agentRunId: "r-late" })],
      todos: [],
    });
    expect(s.latestCompletedRun?.id).toBe("r-late");
    // Latest has no test_result → warning fires.
    expect(s.warnings.map((w) => w.code)).toContain("missing_test_result");
  });
});

describe("P02C McpSyncService.derive", () => {
  let db: DbClient;
  let wsId: string;
  let projectId: string;

  beforeAll(async () => {
    db = createInMemoryDb();
    setDbClient(db);
    const ws = await workspaceService.create(db, SOLO_ACTOR, { slug: "sync-ws", name: "Sync" });
    wsId = ws.id;
    const project = await projectService.create(db, SOLO_ACTOR, wsId, {
      slug: "sync-proj",
      name: "Sync Project",
      identifier: "SYNC",
    });
    projectId = project.id;
  });

  it("returns not_configured when the workspace has zero non-revoked tokens", async () => {
    const other = await workspaceService.create(db, SOLO_ACTOR, { slug: "sync-empty", name: "Empty" });
    const s = await mcpSyncService.derive(db, other.id);
    expect(s.state).toBe("not_configured");
    expect(s.activeTokenCount).toBe(0);
  });

  it("returns syncing when a run with status='running' exists", async () => {
    const actor = { type: "remote_mcp" as const, id: "tok", name: "agent" };
    await tokenService.issue(db, wsId, { name: "t1", scopes: ["read", "write_agent_state"] });
    await agentRunService.start(db, actor, wsId, {
      projectId,
      agent: "opencode",
      runType: "implement",
    });
    const s = await mcpSyncService.derive(db, wsId);
    expect(s.state).toBe("syncing");
    expect(s.runningCount).toBeGreaterThan(0);
  });

  it("returns connected after a run completes within 24h", async () => {
    const fresh = await workspaceService.create(db, SOLO_ACTOR, { slug: "sync-conn", name: "Conn" });
    const freshProj = await projectService.create(db, SOLO_ACTOR, fresh.id, {
      slug: "conn-proj",
      name: "Conn Project",
      identifier: "CONN",
    });
    const actor = { type: "remote_mcp" as const, id: "tok2", name: "agent" };
    await tokenService.issue(db, fresh.id, { name: "t2", scopes: ["read", "write_agent_state"] });
    const r = await agentRunService.start(db, actor, fresh.id, {
      projectId: freshProj.id,
      agent: "opencode",
      runType: "implement",
    });
    await agentRunService.complete(db, actor, fresh.id, r.id, { summary: "done", testResult: "pass" });
    const s = await mcpSyncService.derive(db, fresh.id);
    expect(s.state).toBe("connected");
    expect(s.lastRunAt).not.toBeNull();
  });

  it("returns idle when the workspace has tokens but no runs at all", async () => {
    const fresh = await workspaceService.create(db, SOLO_ACTOR, { slug: "sync-idle", name: "Idle" });
    await tokenService.issue(db, fresh.id, { name: "t-idle", scopes: ["read"] });
    const s = await mcpSyncService.derive(db, fresh.id);
    expect(s.state).toBe("idle");
  });
});

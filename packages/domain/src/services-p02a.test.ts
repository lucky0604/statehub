/**
 * P02A domain tests — agent sync foundation.
 *
 * Covers the P02A acceptance criteria that live in the domain layer:
 *   - TokenService: issue/verify, scope enforcement, revoke, expiry
 *   - IdempotencyService: same key → first response; different args → conflict
 *   - AgentRunService: start (running), complete (running→completed + evidence),
 *     complete-on-non-running → conflict, workspace isolation
 *   - TodoService: create, update_status, evidence_required gate, no-reopen
 *   - EvidenceService: create, link, workspace isolation
 *
 * Same in-memory isolation pattern as the P01 test suites.
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
  tokenService,
  requireScope,
  idempotencyService,
  hashRequest,
  agentRunService,
  todoService,
  evidenceService,
  ForbiddenError,
  ConflictError,
} from "@statehub/domain";

describe("P02A TokenService", () => {
  let db: DbClient;
  let wsId: string;

  beforeAll(async () => {
    db = createInMemoryDb();
    setDbClient(db);
    const ws = await workspaceService.create(db, SOLO_ACTOR, { slug: "p02a-ws", name: "P02A" });
    wsId = ws.id;
  });

  it("issues a token, verifies it, and returns workspace + scopes", async () => {
    const issued = await tokenService.issue(db, wsId, {
      name: "agent-token",
      scopes: ["read", "write_agent_state"],
    });
    expect(issued.token).toMatch(/^sth_/);
    expect(issued.prefix).toHaveLength(8);

    const verified = await tokenService.verify(db, issued.token);
    expect(verified).not.toBeNull();
    expect(verified!.workspaceId).toBe(wsId);
    expect(verified!.scopes).toContain("write_agent_state");
  });

  it("rejects an invalid token (wrong hash)", async () => {
    const verified = await tokenService.verify(db, "sth_definitelynotreal123");
    expect(verified).toBeNull();
  });

  it("enforces scope: a read-only token cannot pass requireScope for write_agent_state", async () => {
    const issued = await tokenService.issue(db, wsId, {
      name: "ro",
      scopes: ["read"],
    });
    const verified = await tokenService.verify(db, issued.token);
    expect(() => requireScope(verified!, "write_agent_state")).toThrow(ForbiddenError);
    expect(() => requireScope(verified!, "read")).not.toThrow();
  });

  it("rejects a revoked token", async () => {
    const issued = await tokenService.issue(db, wsId, { name: "to-revoke", scopes: ["read"] });
    await tokenService.revoke(db, wsId, issued.tokenId);
    expect(await tokenService.verify(db, issued.token)).toBeNull();
  });

  it("updates last_used_at on verification", async () => {
    const issued = await tokenService.issue(db, wsId, { name: "used", scopes: ["read"] });
    await tokenService.verify(db, issued.token);
    const list = await tokenService.list(db, wsId);
    const found = list.find((t) => t.id === issued.tokenId);
    expect(found!.lastUsedAt).not.toBeNull();
  });
});

describe("P02A IdempotencyService", () => {
  let db: DbClient;
  let wsId: string;

  beforeAll(async () => {
    db = createInMemoryDb();
    setDbClient(db);
    const ws = await workspaceService.create(db, SOLO_ACTOR, { slug: "idem-ws", name: "Idem" });
    wsId = ws.id;
  });

  it("returns a miss on first check, then a hit with the stored response", async () => {
    const hash = await hashRequest({ a: 1 });
    const first = await idempotencyService.check(db, wsId, "key-1", hash);
    expect(first.hit).toBe(false);

    const response = { ok: true, data: { run_id: "run_1" } };
    await idempotencyService.record(db, wsId, "key-1", "start_agent_run", hash, response);

    const second = await idempotencyService.check(db, wsId, "key-1", hash);
    expect(second.hit).toBe(true);
    expect(second.response).toEqual(response);
  });

  it("conflicts when the same key is reused with different request args", async () => {
    const hashA = await hashRequest({ a: 1 });
    const hashB = await hashRequest({ a: 2 });
    await idempotencyService.record(db, wsId, "key-2", "start_agent_run", hashA, { ok: true });
    await expect(idempotencyService.check(db, wsId, "key-2", hashB)).rejects.toThrow(ConflictError);
  });

  it("isolates idempotency by workspace", async () => {
    const other = await workspaceService.create(db, SOLO_ACTOR, { slug: "idem-other", name: "Other" });
    const hash = await hashRequest({ x: 1 });
    await idempotencyService.record(db, wsId, "shared-key", "start_agent_run", hash, { ok: true });
    // Same key in a different workspace is a fresh miss (no cross-workspace leak).
    const result = await idempotencyService.check(db, other.id, "shared-key", hash);
    expect(result.hit).toBe(false);
  });
});

describe("P02A AgentRunService", () => {
  let db: DbClient;
  let wsId: string;
  let projectId: string;
  let featureId: string;

  beforeAll(async () => {
    db = createInMemoryDb();
    setDbClient(db);
    const ws = await workspaceService.create(db, SOLO_ACTOR, { slug: "run-ws", name: "Run" });
    wsId = ws.id;
    const project = await projectService.create(db, SOLO_ACTOR, wsId, {
      slug: "run-proj",
      name: "Run Project",
      identifier: "RUN",
    });
    projectId = project.id;
    const feature = await featureService.create(db, SOLO_ACTOR, wsId, projectId, { name: "F1" });
    featureId = feature.id;
  });

  it("starts a run in 'running' status", async () => {
    const actor = remoteMcpActor("opencode", "tok-1");
    const run = await agentRunService.start(db, actor, wsId, {
      projectId,
      featureId,
      agent: "opencode",
      runType: "implement",
      model: "glm-5.2",
    });
    expect(run.status).toBe("running");
    expect(run.evidenceTrustState).toBe("unknown");
    expect(run.agent).toBe("opencode");
  });

  it("completes a running run, sets evidence_trust_state to working_tree, and creates an evidence row", async () => {
    const actor = remoteMcpActor("opencode", "tok-2");
    const run = await agentRunService.start(db, actor, wsId, {
      projectId,
      featureId,
      agent: "opencode",
      runType: "implement",
    });
    const completed = await agentRunService.complete(db, actor, wsId, run.id, {
      summary: "Implemented the feature",
      filesChanged: ["src/a.ts"],
      commandsRun: ["pnpm test"],
      testResult: "all passing",
      risks: ["flaky test"],
      nextSteps: ["add e2e"],
    });
    expect(completed.status).toBe("completed");
    expect(completed.evidenceTrustState).toBe("working_tree");
    expect(completed.finishedAt).not.toBeNull();

    const evidence = await evidenceService.listForAgentRun(db, wsId, run.id);
    expect(evidence.length).toBe(1);
    expect(evidence[0]!.trustState).toBe("working_tree");
    expect(evidence[0]!.evidenceType).toBe("agent_run");
  });

  it("rejects completing a non-running run with a conflict", async () => {
    const actor = remoteMcpActor("opencode", "tok-3");
    const run = await agentRunService.start(db, actor, wsId, {
      projectId,
      agent: "opencode",
      runType: "implement",
    });
    await agentRunService.complete(db, actor, wsId, run.id, { summary: "done once" });
    await expect(
      agentRunService.complete(db, actor, wsId, run.id, { summary: "done again" }),
    ).rejects.toThrow(ConflictError);
  });

  it("isolates runs by workspace", async () => {
    const other = await workspaceService.create(db, SOLO_ACTOR, { slug: "run-other", name: "Other" });
    const otherProj = await projectService.create(db, SOLO_ACTOR, other.id, {
      slug: "op",
      name: "OP",
      identifier: "OPP",
    });
    const actor = remoteMcpActor("opencode", "tok-4");
    const run = await agentRunService.start(db, actor, other.id, {
      projectId: otherProj.id,
      agent: "opencode",
      runType: "implement",
    });
    // Cross-workspace get returns null.
    expect(await agentRunService.get(db, wsId, run.id)).toBeNull();
    expect(await agentRunService.get(db, other.id, run.id)).not.toBeNull();
  });

  it("rejects starting a run for a project outside the workspace", async () => {
    const other = await workspaceService.create(db, SOLO_ACTOR, { slug: "run-x", name: "X" });
    const actor = remoteMcpActor("opencode", "tok-5");
    await expect(
      agentRunService.start(db, actor, other.id, {
        projectId, // belongs to wsId, not other.id
        agent: "opencode",
        runType: "implement",
      }),
    ).rejects.toThrow(/not found/i);
  });
});

describe("P02A TodoService", () => {
  let db: DbClient;
  let wsId: string;
  let projectId: string;
  let featureId: string;

  beforeAll(async () => {
    db = createInMemoryDb();
    setDbClient(db);
    const ws = await workspaceService.create(db, SOLO_ACTOR, { slug: "todo-ws", name: "Todo" });
    wsId = ws.id;
    const project = await projectService.create(db, SOLO_ACTOR, wsId, {
      slug: "todo-proj",
      name: "Todo Project",
      identifier: "TODO",
    });
    projectId = project.id;
    const feature = await featureService.create(db, SOLO_ACTOR, wsId, projectId, { name: "TF" });
    featureId = feature.id;
  });

  it("creates a todo in 'backlog' status", async () => {
    const todo = await todoService.create(db, SOLO_ACTOR, wsId, {
      projectId,
      featureId,
      title: "Write tests",
      type: "implementation",
    });
    expect(todo.status).toBe("backlog");
    expect(todo.title).toBe("Write tests");
  });

  it("updates status and records from->to via the event log", async () => {
    const todo = await todoService.create(db, SOLO_ACTOR, wsId, {
      projectId,
      featureId,
      title: "Run migration",
    });
    const updated = await todoService.updateStatus(db, SOLO_ACTOR, wsId, todo.id, {
      status: "in_progress",
    });
    expect(updated.status).toBe("in_progress");
    expect(updated.completedAt).toBeNull();

    const done = await todoService.updateStatus(db, SOLO_ACTOR, wsId, todo.id, {
      status: "done",
      evidenceSummary: "migration applied",
    });
    expect(done.status).toBe("done");
    expect(done.completedAt).not.toBeNull();

    // Event log captured the transition.
    const events = await db.all<{ event_type: string; payload_json: string }>(
      "SELECT event_type, payload_json FROM events WHERE workspace_id = ? AND entity_type = 'todo' AND entity_id = ? ORDER BY created_at ASC",
      [wsId, todo.id],
    );
    const transitions = events
      .filter((e) => e.event_type === "todo.status_changed")
      .map((e) => JSON.parse(e.payload_json) as { from: string; to: string });
    // Two transitions: backlog->in_progress, then in_progress->done.
    expect(transitions.map((t) => ({ from: t.from, to: t.to }))).toEqual([
      { from: "backlog", to: "in_progress" },
      { from: "in_progress", to: "done" },
    ]);
  });

  it("requires an evidence_summary to mark done when evidence_required=1", async () => {
    const todo = await todoService.create(db, SOLO_ACTOR, wsId, {
      projectId,
      featureId,
      title: "Evidence-gated",
      evidenceRequired: 1,
    });
    await expect(
      todoService.updateStatus(db, SOLO_ACTOR, wsId, todo.id, { status: "done" }),
    ).rejects.toThrow(/evidence_summary/i);

    // With a summary it succeeds.
    const done = await todoService.updateStatus(db, SOLO_ACTOR, wsId, todo.id, {
      status: "done",
      evidenceSummary: "verified",
    });
    expect(done.status).toBe("done");
  });

  it("does not allow reopening a done todo", async () => {
    const todo = await todoService.create(db, SOLO_ACTOR, wsId, {
      projectId,
      featureId,
      title: "No reopen",
    });
    await todoService.updateStatus(db, SOLO_ACTOR, wsId, todo.id, { status: "done" });
    await expect(
      todoService.updateStatus(db, SOLO_ACTOR, wsId, todo.id, { status: "in_progress" }),
    ).rejects.toThrow(ConflictError);
  });
});

describe("P02A EvidenceService", () => {
  let db: DbClient;
  let wsId: string;
  let projectId: string;

  beforeAll(async () => {
    db = createInMemoryDb();
    setDbClient(db);
    const ws = await workspaceService.create(db, SOLO_ACTOR, { slug: "ev-ws", name: "Ev" });
    wsId = ws.id;
    const project = await projectService.create(db, SOLO_ACTOR, wsId, {
      slug: "ev-proj",
      name: "Ev Project",
      identifier: "EVID",
    });
    projectId = project.id;
  });

  it("creates evidence with the given trust + staleness states", async () => {
    const ev = await evidenceService.create(db, SOLO_ACTOR, wsId, {
      projectId,
      evidenceType: "test_result",
      title: "Unit tests pass",
      trustState: "working_tree",
      stalenessState: "fresh",
    });
    expect(ev.trustState).toBe("working_tree");
    expect(ev.stalenessState).toBe("fresh");
  });

  it("links evidence to a work item and records a linked event", async () => {
    const ev = await evidenceService.create(db, SOLO_ACTOR, wsId, {
      projectId,
      evidenceType: "command",
      title: "ran lint",
    });
    const linked = await evidenceService.link(db, SOLO_ACTOR, wsId, ev.id, { workItemId: "wi-1" });
    expect(linked.workItemId).toBe("wi-1");

    const events = await db.all<{ event_type: string }>(
      "SELECT event_type FROM events WHERE workspace_id = ? AND entity_type = 'evidence' AND entity_id = ?",
      [wsId, ev.id],
    );
    expect(events.map((e) => e.event_type)).toContain("evidence.linked");
  });

  it("isolates evidence by workspace", async () => {
    const ev = await evidenceService.create(db, SOLO_ACTOR, wsId, {
      projectId,
      evidenceType: "file_change",
      title: "changed a.ts",
    });
    const other = await workspaceService.create(db, SOLO_ACTOR, { slug: "ev-other", name: "Other" });
    expect(await evidenceService.get(db, other.id, ev.id)).toBeNull();
  });
});

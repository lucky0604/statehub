/**
 * P05A domain tests — decisionService, weeklyReviewService, actionCardService,
 * and aiPmService (with DeterministicProvider). Action validators are
 * exercised end-to-end via actionCardService.apply.
 *
 * Covers:
 *   - decisionService.record + list
 *   - weeklyReviewService.save + list + get
 *   - actionCardService.create + list + apply (create_work_item path)
 *   - actionCardService.dismiss (with reason for high-risk)
 *   - actionCardService.edit (payload update)
 *   - aiPmService.query returns answer + cards (DeterministicProvider)
 *   - mark_feature_done apply blocked by Done Gate
 *   - high-risk apply without confirmation → high_risk_confirmation_required
 *   - dismiss high-risk without reason → validation_error
 *
 * Same in-memory isolation pattern as P03/P04 suites.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { setDbClient, createInMemoryDb } from "@statehub/db/node";
import type { DbClient } from "@statehub/db";
import {
  SOLO_ACTOR,
  workspaceService,
  projectService,
  featureService,
  workItemService,
  stateService,
  decisionService,
  weeklyReviewService,
  actionCardService,
  createAiPmService,
  DoneGateBlockedError,
  ValidationError,
  ConflictError,
  NotFoundError,
} from "@statehub/domain";
import { DeterministicProvider } from "@statehub/ai";

describe("P05A decisionService", () => {
  let db: DbClient;
  let wsId: string;
  let projectId: string;

  beforeAll(async () => {
    db = createInMemoryDb();
    setDbClient(db);
    const ws = await workspaceService.create(db, SOLO_ACTOR, {
      slug: "p05a-dec",
      name: "P05A Dec",
    });
    wsId = ws.id;
    const project = await projectService.create(db, SOLO_ACTOR, wsId, {
      slug: "proj",
      name: "P",
      identifier: "PDEC",
    });
    projectId = project.id;
  });

  it("records a decision with rationale + source", async () => {
    const d = await decisionService.record(db, SOLO_ACTOR, wsId, {
      projectId,
      decisionText: "Pause work on Phase 6 until Q3.",
      rationale: "Cost overrun in Q2.",
      source: "user",
    });
    expect(d.id).toBeTruthy();
    expect(d.decisionText).toContain("Pause work");
    expect(d.source).toBe("user");
    expect(d.rationale).toBe("Cost overrun in Q2.");
  });

  it("lists decisions filtered by project", async () => {
    const list = await decisionService.list(db, wsId, { projectId });
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0]!.projectId).toBe(projectId);
  });

  it("rejects an empty decision_text", async () => {
    await expect(
      decisionService.record(db, SOLO_ACTOR, wsId, {
        projectId,
        decisionText: "",
        source: "user",
      }),
    ).rejects.toThrow(ValidationError);
  });
});

describe("P05A weeklyReviewService", () => {
  let db: DbClient;
  let wsId: string;
  let projectId: string;

  beforeAll(async () => {
    db = createInMemoryDb();
    setDbClient(db);
    const ws = await workspaceService.create(db, SOLO_ACTOR, {
      slug: "p05a-wr",
      name: "P05A WR",
    });
    wsId = ws.id;
    const project = await projectService.create(db, SOLO_ACTOR, wsId, {
      slug: "proj",
      name: "P",
      identifier: "PWR",
    });
    projectId = project.id;
  });

  it("saves + lists + gets a weekly review", async () => {
    const summary = JSON.stringify({
      completed: 3,
      stalled: 1,
      open_risks: 0,
    });
    const wr = await weeklyReviewService.save(db, SOLO_ACTOR, wsId, {
      projectId,
      weekStart: 1719792000000,
      weekEnd: 1720396800000,
      summaryJson: summary,
    });
    expect(wr.id).toBeTruthy();

    const list = await weeklyReviewService.list(db, wsId, { projectId });
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(wr.id);

    const got = await weeklyReviewService.get(db, wsId, wr.id);
    expect(got?.summaryJson).toBe(summary);
  });

  it("rejects week_end < week_start", async () => {
    await expect(
      weeklyReviewService.save(db, SOLO_ACTOR, wsId, {
        projectId,
        weekStart: 200,
        weekEnd: 100,
        summaryJson: "{}",
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects invalid JSON summary", async () => {
    await expect(
      weeklyReviewService.save(db, SOLO_ACTOR, wsId, {
        projectId,
        weekStart: 100,
        weekEnd: 200,
        summaryJson: "not-json{",
      }),
    ).rejects.toThrow(ValidationError);
  });
});

describe("P05A actionCardService", () => {
  let db: DbClient;
  let wsId: string;
  let projectId: string;
  let featureId: string;

  beforeAll(async () => {
    db = createInMemoryDb();
    setDbClient(db);
    const ws = await workspaceService.create(db, SOLO_ACTOR, {
      slug: "p05a-ac",
      name: "P05A AC",
    });
    wsId = ws.id;
    const project = await projectService.create(db, SOLO_ACTOR, wsId, {
      slug: "proj",
      name: "P",
      identifier: "PAC",
    });
    projectId = project.id;
    const feature = await featureService.create(db, SOLO_ACTOR, wsId, projectId, {
      name: "F",
      description: "F",
    });
    featureId = feature.id;
    const states = await stateService.list(db, wsId, projectId);
    void states; // stateService.list verifies states are seeded; not used below
  });

  it("creates + lists a pending create_work_item card", async () => {
    const card = await actionCardService.create(
      db,
      SOLO_ACTOR,
      wsId,
      "query-1",
      {
        type: "create_work_item",
        title: "Add input validation",
        target: { project_id: projectId, feature_id: featureId },
        payload: {
          title: "Validate input",
          type: "task",
          priority: "high",
        },
        reason: "Coverage is low",
        requires_confirmation: false,
      },
    );
    expect(card.id).toBeTruthy();
    expect(card.status).toBe("pending");
    expect(card.actionType).toBe("create_work_item");

    const list = await actionCardService.list(db, wsId, { status: "pending" });
    expect(list).toHaveLength(1);
  });

  it("applies a create_work_item card → work item created + status flipped", async () => {
    const card = await actionCardService.create(
      db,
      SOLO_ACTOR,
      wsId,
      "query-2",
      {
        type: "create_work_item",
        title: "Add e2e test",
        target: { project_id: projectId, feature_id: featureId },
        payload: {
          title: "E2E for AI PM",
          type: "task",
          priority: "medium",
        },
        reason: "Need coverage",
        requires_confirmation: false,
      },
    );
    const { result, card: applied } = await actionCardService.apply(
      db,
      SOLO_ACTOR,
      wsId,
      card.id,
    );
    expect(applied.status).toBe("applied");
    expect(applied.appliedAt).toBeTruthy();
    expect(result.kind).toBe("create_work_item");

    // The work item exists.
    const wi = await workItemService.get(db, wsId, (result as { workItemId: string }).workItemId);
    expect(wi?.title).toBe("E2E for AI PM");
  });

  it("rejects apply on an already-applied card", async () => {
    const card = await actionCardService.create(
      db,
      SOLO_ACTOR,
      wsId,
      "query-3",
      {
        type: "create_work_item",
        title: "x",
        target: { project_id: projectId, feature_id: featureId },
        payload: { title: "x", type: "task" },
        reason: "x",
        requires_confirmation: false,
      },
    );
    await actionCardService.apply(db, SOLO_ACTOR, wsId, card.id);
    await expect(
      actionCardService.apply(db, SOLO_ACTOR, wsId, card.id),
    ).rejects.toThrow(ConflictError);
  });

  it("rejects high-risk apply without confirmHighRisk", async () => {
    const card = await actionCardService.create(
      db,
      SOLO_ACTOR,
      wsId,
      "query-4",
      {
        type: "pause_project",
        title: "Pause project",
        target: {},
        payload: { project_id: projectId, rationale: "Cost" },
        reason: "Cost",
        risk: "Delays",
        requires_confirmation: true,
      },
    );
    await expect(
      actionCardService.apply(db, SOLO_ACTOR, wsId, card.id),
    ).rejects.toThrow(ValidationError);
  });

  it("dismisses a normal card without a reason", async () => {
    const card = await actionCardService.create(
      db,
      SOLO_ACTOR,
      wsId,
      "query-5",
      {
        type: "create_work_item",
        title: "x",
        target: { project_id: projectId, feature_id: featureId },
        payload: { title: "x", type: "task" },
        reason: "x",
        requires_confirmation: false,
      },
    );
    const dismissed = await actionCardService.dismiss(db, SOLO_ACTOR, wsId, card.id);
    expect(dismissed.status).toBe("dismissed");
    expect(dismissed.dismissedAt).toBeTruthy();
  });

  it("rejects dismissing a high-risk card without a reason", async () => {
    const card = await actionCardService.create(
      db,
      SOLO_ACTOR,
      wsId,
      "query-6",
      {
        type: "pause_project",
        title: "x",
        target: {},
        payload: { project_id: projectId, rationale: "x" },
        reason: "x",
        risk: "x",
        requires_confirmation: true,
      },
    );
    await expect(
      actionCardService.dismiss(db, SOLO_ACTOR, wsId, card.id),
    ).rejects.toThrow(ValidationError);
  });

  it("edits a pending card payload + increments edit_count", async () => {
    const card = await actionCardService.create(
      db,
      SOLO_ACTOR,
      wsId,
      "query-7",
      {
        type: "create_work_item",
        title: "x",
        target: { project_id: projectId, feature_id: featureId },
        payload: { title: "Original", type: "task" },
        reason: "x",
        requires_confirmation: false,
      },
    );
    const edited = await actionCardService.edit(
      db,
      SOLO_ACTOR,
      wsId,
      card.id,
      { title: "Edited title", type: "task", priority: "urgent" },
    );
    expect(edited.editCount).toBe(1);
    expect(JSON.parse(edited.payloadJson).title).toBe("Edited title");
  });

  it("mark_feature_done is blocked by Done Gate", async () => {
    // The feature has no evidence, no completed runs, no todos → Done Gate blocks.
    const card = await actionCardService.create(
      db,
      SOLO_ACTOR,
      wsId,
      "query-8",
      {
        type: "mark_feature_done",
        title: "Mark feature done",
        target: { feature_id: featureId },
        payload: { feature_id: featureId },
        reason: "Looks done",
        risk: "Gate may block",
        requires_confirmation: true,
      },
    );
    await expect(
      actionCardService.apply(db, SOLO_ACTOR, wsId, card.id, {
        confirmHighRisk: true,
      }),
    ).rejects.toThrow(DoneGateBlockedError);
  });

  it("rejects apply on a non-existent card", async () => {
    await expect(
      actionCardService.apply(db, SOLO_ACTOR, wsId, "card-does-not-exist"),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("P05A aiPmService.query (DeterministicProvider)", () => {
  let db: DbClient;
  let wsId: string;
  let projectId: string;
  let featureId: string;

  beforeAll(async () => {
    db = createInMemoryDb();
    setDbClient(db);
    const ws = await workspaceService.create(db, SOLO_ACTOR, {
      slug: "p05a-ai",
      name: "P05A AI",
    });
    wsId = ws.id;
    const project = await projectService.create(db, SOLO_ACTOR, wsId, {
      slug: "proj",
      name: "P",
      identifier: "PAI",
    });
    projectId = project.id;
    const feature = await featureService.create(db, SOLO_ACTOR, wsId, projectId, {
      name: "F",
      description: "F",
    });
    featureId = feature.id;
    // Feature transitions: backlog → planned → in_progress.
    await featureService.changeStatus(db, SOLO_ACTOR, wsId, featureId, "planned");
    await featureService.changeStatus(db, SOLO_ACTOR, wsId, featureId, "in_progress");
  });

  it("returns an answer + persisted action cards in advisor mode", async () => {
    const service = createAiPmService({ provider: new DeterministicProvider() });
    const result = await service.query(db, SOLO_ACTOR, wsId, {
      mode: "advisor",
      projectId,
      featureId,
    });
    expect(result.queryId).toBeTruthy();
    expect(result.answer.mode).toBe("advisor");
    expect(result.answer.conclusion.length).toBeGreaterThan(0);
    expect(result.providerName).toBe("deterministic");
    expect(Array.isArray(result.actionCards)).toBe(true);
  });

  it("persists action cards with status=pending", async () => {
    const service = createAiPmService({ provider: new DeterministicProvider() });
    const result = await service.query(db, SOLO_ACTOR, wsId, {
      mode: "plan",
      projectId,
      featureId,
    });
    for (const card of result.actionCards) {
      expect(card.status).toBe("pending");
      expect(card.aiPmQueryId).toBe(result.queryId);
    }
  });

  it("emits an ai_pm.query event (visible via the events table)", async () => {
    const before = await db.all<{ event_type: string }>(
      "SELECT event_type FROM events WHERE workspace_id = ? AND event_type = 'ai_pm.query'",
      [wsId],
    );
    const service = createAiPmService({ provider: new DeterministicProvider() });
    await service.query(db, SOLO_ACTOR, wsId, {
      mode: "advisor",
      projectId,
      featureId,
    });
    const after = await db.all<{ event_type: string }>(
      "SELECT event_type FROM events WHERE workspace_id = ? AND event_type = 'ai_pm.query'",
      [wsId],
    );
    expect(after.length).toBeGreaterThan(before.length);
  });
});

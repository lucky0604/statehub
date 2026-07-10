/**
 * P01B domain smoke — views, cycles, label assignment, bulk status, extended filters.
 *
 * Same in-memory isolation as services.test.ts.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { setDbClient, createInMemoryDb, type DbClient } from "@statehub/db";
import {
  SOLO_ACTOR,
  workspaceService,
  projectService,
  stateService,
  labelService,
  workItemService,
  viewService,
  cycleService,
  parseViewQuery,
} from "@statehub/domain";

describe("domain P01B services", () => {
  let db: DbClient;
  let wsId: string;
  let projectId: string;
  let labelBugId: string;
  let labelFeatureId: string;

  beforeAll(async () => {
    db = createInMemoryDb();
    setDbClient(db);

    const ws = await workspaceService.create(db, SOLO_ACTOR, {
      slug: "p01b-ws",
      name: "P01B Workspace",
    });
    wsId = ws.id;

    const project = await projectService.create(db, SOLO_ACTOR, wsId, {
      slug: "p01b-proj",
      name: "P01B Project",
      identifier: "P01B",
    });
    projectId = project.id;

    const labels = await labelService.list(db, wsId, projectId);
    labelBugId = labels.find((l) => l.name === "bug")!.id;
    labelFeatureId = labels.find((l) => l.name === "feature")!.id;
  });

  it("creates and lists cycles", async () => {
    const c = await cycleService.create(db, SOLO_ACTOR, wsId, projectId, {
      name: "Sprint 1",
    });
    expect(c.status).toBe("active");
    const list = await cycleService.list(db, wsId, projectId);
    expect(list.length).toBe(1);
    expect(list[0]!.name).toBe("Sprint 1");
  });

  it("rejects a duplicate cycle name", async () => {
    await expect(
      cycleService.create(db, SOLO_ACTOR, wsId, projectId, { name: "Sprint 1" }),
    ).rejects.toThrow(/already exists|conflict/i);
  });

  it("creates a saved view and enforces name uniqueness", async () => {
    const v = await viewService.create(db, SOLO_ACTOR, wsId, projectId, {
      name: "High Priority",
      layout: "list",
      query: { priorities: ["high", "urgent"] },
      display: { orderBy: "priority" },
    });
    expect(v.layout).toBe("list");
    expect(parseViewQuery(v.queryJson).priorities).toEqual(["high", "urgent"]);

    const list = await viewService.list(db, wsId, projectId);
    expect(list.length).toBe(1);

    await expect(
      viewService.create(db, SOLO_ACTOR, wsId, projectId, { name: "High Priority", query: {} }),
    ).rejects.toThrow(/already exists|conflict/i);
  });

  it("assigns labels and returns the current set", async () => {
    const wi = await workItemService.create(db, SOLO_ACTOR, wsId, projectId, {
      title: "labelled item",
    });
    const assigned = await workItemService.setLabels(db, SOLO_ACTOR, wsId, wi.id, [
      labelBugId,
      labelFeatureId,
    ]);
    expect(assigned.sort()).toEqual([labelBugId, labelFeatureId].sort());

    const fetched = await workItemService.listLabelIds(db, wsId, wi.id);
    expect(fetched.sort()).toEqual([labelBugId, labelFeatureId].sort());

    // Remove one label
    const after = await workItemService.setLabels(db, SOLO_ACTOR, wsId, wi.id, [labelBugId]);
    expect(after).toEqual([labelBugId]);
    expect(await workItemService.listLabelIds(db, wsId, wi.id)).toEqual([labelBugId]);
  });

  it("rejects assigning a label from another workspace/project", async () => {
    const wi = await workItemService.create(db, SOLO_ACTOR, wsId, projectId, {
      title: "isolation item",
    });
    await expect(
      workItemService.setLabels(db, SOLO_ACTOR, wsId, wi.id, ["not-a-real-label"]),
    ).rejects.toThrow(/not found/i);
  });

  it("filters work items by label ids", async () => {
    const a = await workItemService.create(db, SOLO_ACTOR, wsId, projectId, {
      title: "with bug label",
    });
    await workItemService.setLabels(db, SOLO_ACTOR, wsId, a.id, [labelBugId]);
    const b = await workItemService.create(db, SOLO_ACTOR, wsId, projectId, {
      title: "no labels",
    });

    const filtered = await workItemService.list(db, wsId, projectId, {
      labelIds: [labelBugId],
    });
    const ids = filtered.map((w) => w.id);
    expect(ids).toContain(a.id);
    expect(ids).not.toContain(b.id);
  });

  it("filters by multiple status groups and priorities", async () => {
    const states = await stateService.list(db, wsId, projectId);
    const todo = states.find((s) => s.name === "Todo")!;
    const done = states.find((s) => s.name === "Done")!;

    const wTodo = await workItemService.create(db, SOLO_ACTOR, wsId, projectId, {
      title: "todo item",
      priority: "high",
    });
    const wDone = await workItemService.create(db, SOLO_ACTOR, wsId, projectId, {
      title: "done item",
    });
    await workItemService.changeStatus(db, SOLO_ACTOR, wsId, wTodo.id, todo.id);
    await workItemService.changeStatus(db, SOLO_ACTOR, wsId, wDone.id, done.id);

    const both = await workItemService.list(db, wsId, projectId, {
      statusGroups: ["unstarted", "completed"],
    });
    const bothIds = both.map((w) => w.id);
    expect(bothIds).toContain(wTodo.id);
    expect(bothIds).toContain(wDone.id);

    const onlyHigh = await workItemService.list(db, wsId, projectId, {
      priorities: ["high"],
    });
    expect(onlyHigh.map((w) => w.id)).toContain(wTodo.id);
    expect(onlyHigh.map((w) => w.id)).not.toContain(wDone.id);
  });

  it("bulk changes status and reports per-item results", async () => {
    const states = await stateService.list(db, wsId, projectId);
    const done = states.find((s) => s.name === "Done")!;

    const w1 = await workItemService.create(db, SOLO_ACTOR, wsId, projectId, {
      title: "bulk 1",
    });
    const w2 = await workItemService.create(db, SOLO_ACTOR, wsId, projectId, {
      title: "bulk 2",
    });

    const result = await workItemService.bulkChangeStatus(
      db,
      SOLO_ACTOR,
      wsId,
      [w1.id, w2.id, "nonexistent-id"],
      done.id,
    );
    expect(result.updated.sort()).toEqual([w1.id, w2.id].sort());
    expect(result.skipped).toEqual(["nonexistent-id"]);

    const r1 = await workItemService.get(db, wsId, w1.id);
    expect(r1!.statusGroup).toBe("completed");
  });

  it("lists events for a work item (Peek activity)", async () => {
    const wi = await workItemService.create(db, SOLO_ACTOR, wsId, projectId, {
      title: "eventful item",
    });
    const events = await workItemService.listEvents(db, wsId, "work_item", wi.id);
    expect(events.length).toBeGreaterThan(0);
    expect(events.map((e) => e.eventType)).toContain("work_item.created");
  });

  it("bulk status skips no-op items and validates the target state", async () => {
    const states = await stateService.list(db, wsId, projectId);
    const done = states.find((s) => s.name === "Done")!;
    const todo = states.find((s) => s.name === "Todo")!;

    const w1 = await workItemService.create(db, SOLO_ACTOR, wsId, projectId, {
      title: "bulk noop 1",
    });
    await workItemService.changeStatus(db, SOLO_ACTOR, wsId, w1.id, done.id);
    const w2 = await workItemService.create(db, SOLO_ACTOR, wsId, projectId, {
      title: "bulk noop 2",
    });

    // w1 is already Done → no-op → skipped. w2 moves → updated.
    const result = await workItemService.bulkChangeStatus(
      db,
      SOLO_ACTOR,
      wsId,
      [w1.id, w2.id],
      done.id,
    );
    expect(result.updated).toEqual([w2.id]);
    expect(result.skipped).toEqual([w1.id]);

    // Invalid state id → throws NotFoundError (not silent all-skipped).
    await expect(
      workItemService.bulkChangeStatus(db, SOLO_ACTOR, wsId, [w2.id], "not-a-real-state"),
    ).rejects.toThrow(/not found/i);

    // Cross-project state id is rejected too.
    const otherWs = await workspaceService.create(db, SOLO_ACTOR, {
      slug: "p01b-ws2",
      name: "Other WS",
    });
    const otherProj = await projectService.create(db, SOLO_ACTOR, otherWs.id, {
      slug: "other-proj",
      name: "Other Proj",
      identifier: "OTHR",
    });
    const otherStates = await stateService.list(db, otherWs.id, otherProj.id);
    const otherDone = otherStates.find((s) => s.name === "Done")!;
    await expect(
      workItemService.bulkChangeStatus(db, SOLO_ACTOR, wsId, [w2.id], otherDone.id),
    ).rejects.toThrow(/not found/i);

    // touch todo to keep the var referenced
    expect(todo.name).toBe("Todo");
  });

  it("setLabels is idempotent under duplicate input", async () => {
    const wi = await workItemService.create(db, SOLO_ACTOR, wsId, projectId, {
      title: "idempotent labels",
    });
    const assigned = await workItemService.setLabels(db, SOLO_ACTOR, wsId, wi.id, [
      labelBugId,
      labelBugId,
      labelFeatureId,
    ]);
    expect(assigned.sort()).toEqual([labelBugId, labelFeatureId].sort());
    // Re-applying the same set is a no-op that does not throw.
    const again = await workItemService.setLabels(db, SOLO_ACTOR, wsId, wi.id, [
      labelBugId,
      labelFeatureId,
    ]);
    expect(again.sort()).toEqual([labelBugId, labelFeatureId].sort());
  });
});

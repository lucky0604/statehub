/**
 * P01C domain tests — project health heuristics.
 *
 * In-memory DB; builds a workspace + project + states, then exercises each
 * heuristic: current focus, next action, stale, blocked, missing-next-action,
 * suggested next step, portfolio aggregation.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { setDbClient, createInMemoryDb } from "@statehub/db/node";
import type { DbClient } from "@statehub/db";
import {
  SOLO_ACTOR,
  workspaceService,
  projectService,
  stateService,
  workItemService,
  featureService,
  projectHealthService,
} from "@statehub/domain";

const NOW = 1_700_000_000_000; // fixed clock for determinism
const DAY = 24 * 60 * 60 * 1000;

describe("project health heuristics", () => {
  let db: DbClient;
  let wsId: string;
  let projectId: string;
  let states: { Backlog: string; Todo: string; InProgress: string; InReview: string; Done: string; Dropped: string };

  beforeAll(async () => {
    db = createInMemoryDb();
    setDbClient(db);

    const ws = await workspaceService.create(db, SOLO_ACTOR, {
      slug: "health-ws",
      name: "Health WS",
    });
    wsId = ws.id;
    const project = await projectService.create(db, SOLO_ACTOR, wsId, {
      slug: "health-proj",
      name: "Health Proj",
      identifier: "HLTH",
    });
    projectId = project.id;

    const allStates = await stateService.list(db, wsId, projectId);
    const byName = (n: string) => allStates.find((s) => s.name === n)!.id;
    states = {
      Backlog: byName("Backlog"),
      Todo: byName("Todo"),
      InProgress: byName("In Progress"),
      InReview: byName("In Review"),
      Done: byName("Done"),
      Dropped: byName("Dropped"),
    };
  });

  /** Make a work item and (optionally) move it to a state, with a forced updated_at. */
  async function makeItem(opts: {
    title: string;
    priority?: "urgent" | "high" | "medium" | "low" | "none";
    stateId?: string;
    updatedAtDaysAgo?: number;
  }) {
    const wi = await workItemService.create(db, SOLO_ACTOR, wsId, projectId, {
      title: opts.title,
      priority: opts.priority ?? "none",
      stateId: opts.stateId,
    });
    if (opts.stateId && opts.stateId !== states.Backlog) {
      await workItemService.changeStatus(db, SOLO_ACTOR, wsId, wi.id, opts.stateId);
    }
    if (opts.updatedAtDaysAgo !== undefined) {
      const ts = NOW - opts.updatedAtDaysAgo * DAY;
      await db.run("UPDATE work_items SET updated_at = ? WHERE id = ?", [ts, wi.id]);
    }
    return wi;
  }

  it("current focus = latest-updated started work item", async () => {
    const w1 = await makeItem({ title: "started-old", stateId: states.InProgress, updatedAtDaysAgo: 3 });
    const w2 = await makeItem({ title: "started-new", stateId: states.InProgress, updatedAtDaysAgo: 1 });
    await makeItem({ title: "todo-item", stateId: states.Todo });

    const summary = await projectHealthService.summarize(db, wsId, projectId, { now: NOW });
    expect(summary.currentFocus).not.toBeNull();
    expect(summary.currentFocus!.workItemId).toBe(w2.id);
    expect(summary.startedCount).toBe(2);
    void w1;
  });

  it("current focus falls back to first in_progress feature when nothing is started", async () => {
    // fresh project to avoid the items above
    const ws2 = await workspaceService.create(db, SOLO_ACTOR, { slug: "hf-ws2", name: "HF2" });
    const p2 = await projectService.create(db, SOLO_ACTOR, ws2.id, {
      slug: "hf-p2", name: "HF P2", identifier: "HFP2",
    });
    const f = await featureService.create(db, SOLO_ACTOR, ws2.id, p2.id, { name: "Feature X" });
    await featureService.changeStatus(db, SOLO_ACTOR, ws2.id, f.id, "planned");
    await featureService.changeStatus(db, SOLO_ACTOR, ws2.id, f.id, "in_progress");

    const summary = await projectHealthService.summarize(db, ws2.id, p2.id, { now: NOW });
    expect(summary.currentFocus).not.toBeNull();
    expect(summary.currentFocus!.title).toBe("Feature X");
  });

  it("next action = highest-priority unstarted/backlog item, reason set", async () => {
    const ws2 = await workspaceService.create(db, SOLO_ACTOR, { slug: "na-ws", name: "NA" });
    const p2 = await projectService.create(db, SOLO_ACTOR, ws2.id, {
      slug: "na-p", name: "NA P", identifier: "NAPR",
    });
    const s = await stateService.list(db, ws2.id, p2.id);
    const todo = s.find((x) => x.name === "Todo")!.id;
    const backlog = s.find((x) => x.name === "Backlog")!.id;

    await makeItemOn(db, ws2.id, p2.id, todo, "low item", "low", NOW);
    const high = await makeItemOn(db, ws2.id, p2.id, backlog, "high item", "high", NOW);
    await makeItemOn(db, ws2.id, p2.id, todo, "medium item", "medium", NOW);

    const summary = await projectHealthService.summarize(db, ws2.id, p2.id, { now: NOW });
    expect(summary.nextAction).not.toBeNull();
    expect(summary.nextAction!.workItemId).toBe(high.id);
    expect(summary.nextAction!.reason).toMatch(/highest-priority/i);
  });

  it("stale count = started items older than 7 days", async () => {
    const ws2 = await workspaceService.create(db, SOLO_ACTOR, { slug: "st-ws", name: "ST" });
    const p2 = await projectService.create(db, SOLO_ACTOR, ws2.id, {
      slug: "st-p", name: "ST P", identifier: "STPR",
    });
    const s = await stateService.list(db, ws2.id, p2.id);
    const ip = s.find((x) => x.name === "In Progress")!.id;

    await makeItemOn(db, ws2.id, p2.id, ip, "fresh", "none", NOW - 1 * DAY);
    await makeItemOn(db, ws2.id, p2.id, ip, "stale-10d", "none", NOW - 10 * DAY);
    await makeItemOn(db, ws2.id, p2.id, ip, "stale-30d", "none", NOW - 30 * DAY);

    const summary = await projectHealthService.summarize(db, ws2.id, p2.id, { now: NOW });
    expect(summary.staleCount).toBe(2);
  });

  it("blocked count = items in a 'Review' state", async () => {
    const ws2 = await workspaceService.create(db, SOLO_ACTOR, { slug: "bl-ws", name: "BL" });
    const p2 = await projectService.create(db, SOLO_ACTOR, ws2.id, {
      slug: "bl-p", name: "BL P", identifier: "BLPR",
    });
    const s = await stateService.list(db, ws2.id, p2.id);
    const review = s.find((x) => x.name === "In Review")!.id;
    const todo = s.find((x) => x.name === "Todo")!.id;

    await makeItemOn(db, ws2.id, p2.id, review, "in review", "none", NOW);
    await makeItemOn(db, ws2.id, p2.id, todo, "just todo", "none", NOW);

    const summary = await projectHealthService.summarize(db, ws2.id, p2.id, { now: NOW });
    expect(summary.blockedCount).toBe(1);
  });

  it("missing next action when all open work is in-flight (no unstarted/backlog)", async () => {
    const ws2 = await workspaceService.create(db, SOLO_ACTOR, { slug: "mn-ws", name: "MN" });
    const p2 = await projectService.create(db, SOLO_ACTOR, ws2.id, {
      slug: "mn-p", name: "MN P", identifier: "MNPR",
    });
    const s = await stateService.list(db, ws2.id, p2.id);
    const ip = s.find((x) => x.name === "In Progress")!.id;

    await makeItemOn(db, ws2.id, p2.id, ip, "only in flight", "none", NOW);

    const summary = await projectHealthService.summarize(db, ws2.id, p2.id, { now: NOW });
    expect(summary.missingNextAction).toBe(true);
    expect(summary.suggestedNextStep).toMatch(/nothing is queued/i);
  });

  it("suggested next step priority: blocked > missing > stale > continue", async () => {
    const ws2 = await workspaceService.create(db, SOLO_ACTOR, { slug: "sg-ws", name: "SG" });
    const p2 = await projectService.create(db, SOLO_ACTOR, ws2.id, {
      slug: "sg-p", name: "SG P", identifier: "SGPR",
    });
    const s = await stateService.list(db, ws2.id, p2.id);
    const review = s.find((x) => x.name === "In Review")!.id;
    await makeItemOn(db, ws2.id, p2.id, review, "blocked one", "none", NOW);

    const summary = await projectHealthService.summarize(db, ws2.id, p2.id, { now: NOW });
    expect(summary.suggestedNextStep).toMatch(/resolve.*blocked/i);
  });

  it("portfolio aggregates at-risk + open-high across projects", async () => {
    const portfolio = await projectHealthService.portfolio(db, wsId);
    expect(portfolio.byProject.length).toBeGreaterThan(0);
    // The first project has a started item → it's not at-risk unless stale/blocked.
    // openHigh counts urgent/high open across all.
    expect(typeof portfolio.openHigh).toBe("number");
    expect(Array.isArray(portfolio.atRisk)).toBe(true);
  });

  it("rejects invalid project type/status/portfolioPriority on create + update", async () => {
    const ws2 = await workspaceService.create(db, SOLO_ACTOR, { slug: "val-ws", name: "VAL" });
    await expect(
      projectService.create(db, SOLO_ACTOR, ws2.id, {
        slug: "val-p", name: "V", identifier: "VALP",
        type: "not-a-type" as never,
      }),
    ).rejects.toThrow(/type must be one of/i);

    const p = await projectService.create(db, SOLO_ACTOR, ws2.id, {
      slug: "val-p2", name: "V2", identifier: "VALQ",
      type: "open_source",
      portfolioPriority: "P0",
    });
    expect(p.type).toBe("open_source");
    expect(p.portfolioPriority).toBe("P0");

    await expect(
      projectService.update(db, SOLO_ACTOR, ws2.id, p.id, {
        status: "bogus" as never,
      }),
    ).rejects.toThrow(/status must be one of/i);

    await expect(
      projectService.update(db, SOLO_ACTOR, ws2.id, p.id, {
        portfolioPriority: "P99" as never,
      }),
    ).rejects.toThrow(/portfolioPriority must be one of/i);

    // type can be nulled
    const cleared = await projectService.update(db, SOLO_ACTOR, ws2.id, p.id, { type: null });
    expect(cleared.type).toBeNull();
  });
});

/** Helper: create a work item in a given state with a forced updated_at. */
async function makeItemOn(
  db: DbClient,
  wsId: string,
  projectId: string,
  stateId: string,
  title: string,
  priority: "urgent" | "high" | "medium" | "low" | "none",
  updatedAt: number,
) {
  const wi = await workItemService.create(db, SOLO_ACTOR, wsId, projectId, {
    title,
    priority,
    stateId,
  });
  await db.run("UPDATE work_items SET updated_at = ? WHERE id = ?", [updatedAt, wi.id]);
  return wi;
}

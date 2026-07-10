/**
 * Smoke test for the domain service layer.
 *
 * Uses a fresh in-memory SQLite database (via createInMemoryDb) so the test is
 * fully isolated — no shared local.db, no cleanup needed.
 *
 * Verifies the core P01A flow:
 *   workspace -> project (with default states+labels) -> work item -> status change
 *   sequence allocation, feature transitions, event emission, workspace isolation.
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  setDbClient,
  createInMemoryDb,
  type DbClient,
} from "@statehub/db";
import {
  SOLO_ACTOR,
  workspaceService,
  projectService,
  stateService,
  labelService,
  workItemService,
  featureService,
  sequenceService,
} from "@statehub/domain";

describe("domain services smoke", () => {
  let db: DbClient;

  beforeAll(async () => {
    db = createInMemoryDb();
    setDbClient(db);
  });

  it("creates a workspace", async () => {
    const ws = await workspaceService.create(db, SOLO_ACTOR, {
      slug: "smoke-ws",
      name: "Smoke Test Workspace",
    });
    expect(ws.id).toMatch(/^[\da-f-]{36}$/);
    expect(ws.slug).toBe("smoke-ws");
    expect(ws.version).toBe(1);
  });

  it("creates a project with default states and labels", async () => {
    const ws = await workspaceService.getBySlug(db, "smoke-ws");
    expect(ws).not.toBeNull();

    const project = await projectService.create(db, SOLO_ACTOR, ws!.id, {
      slug: "smoke-proj",
      name: "Smoke Project",
      identifier: "SMOKE",
    });
    expect(project.identifier).toBe("SMOKE");
    expect(project.defaultStateId).not.toBeNull();

    const states = await stateService.list(db, ws!.id, project.id);
    expect(states.length).toBe(6);
    expect(states.map((s) => s.name)).toEqual([
      "Backlog",
      "Todo",
      "In Progress",
      "In Review",
      "Done",
      "Dropped",
    ]);

    const labels = await labelService.list(db, ws!.id, project.id);
    expect(labels.length).toBe(8);
    expect(labels.map((l) => l.name)).toContain("feature");
    expect(labels.map((l) => l.name)).toContain("bug");
  });

  it("allocates sequence ids atomically", async () => {
    const ws = await workspaceService.getBySlug(db, "smoke-ws");
    const projects = await projectService.list(db, ws!.id);
    const project = projects[0]!;

    const seq1 = await sequenceService.next(db, project.id);
    const seq2 = await sequenceService.next(db, project.id);
    const seq3 = await sequenceService.next(db, project.id);
    expect(seq2).toBe(seq1 + 1);
    expect(seq3).toBe(seq2 + 1);
  });

  it("creates a work item with sequence id and identifier", async () => {
    const ws = await workspaceService.getBySlug(db, "smoke-ws");
    const projects = await projectService.list(db, ws!.id);
    const project = projects[0]!;

    const wi = await workItemService.create(db, SOLO_ACTOR, ws!.id, project.id, {
      title: "First work item",
      type: "task",
      priority: "high",
    });
    expect(wi.sequenceId).toBeGreaterThan(0);
    expect(wi.projectIdentifier).toBe("SMOKE");
    expect(wi.statusGroup).toBe("backlog");
    expect(wi.title).toBe("First work item");
  });

  it("creates a feature and transitions status", async () => {
    const ws = await workspaceService.getBySlug(db, "smoke-ws");
    const projects = await projectService.list(db, ws!.id);
    const project = projects[0]!;

    const feature = await featureService.create(db, SOLO_ACTOR, ws!.id, project.id, {
      name: "Feature A",
    });
    expect(feature.status).toBe("backlog");

    const planned = await featureService.changeStatus(db, SOLO_ACTOR, ws!.id, feature.id, "planned");
    expect(planned.status).toBe("planned");

    const inProgress = await featureService.changeStatus(db, SOLO_ACTOR, ws!.id, feature.id, "in_progress");
    expect(inProgress.status).toBe("in_progress");

    // Disallowed transition: in_progress -> backlog (no direct edge)
    await expect(
      featureService.changeStatus(db, SOLO_ACTOR, ws!.id, inProgress.id, "backlog"),
    ).rejects.toThrow(/not allowed/);
  });

  it("changes work item status and updates status_group + completed_at", async () => {
    const ws = await workspaceService.getBySlug(db, "smoke-ws");
    const projects = await projectService.list(db, ws!.id);
    const project = projects[0]!;
    const states = await stateService.list(db, ws!.id, project.id);
    const done = states.find((s) => s.name === "Done")!;

    const wi = await workItemService.create(db, SOLO_ACTOR, ws!.id, project.id, {
      title: "Status change test",
    });
    expect(wi.statusGroup).toBe("backlog");

    const updated = await workItemService.changeStatus(db, SOLO_ACTOR, ws!.id, wi.id, done.id);
    expect(updated.statusGroup).toBe("completed");
    expect(updated.completedAt).not.toBeNull();
    expect(updated.stateId).toBe(done.id);
  });

  it("appends events for every mutation", async () => {
    const ws = await workspaceService.getBySlug(db, "smoke-ws");
    const rows = await db.all<{ event_type: string; entity_type: string }>(
      "SELECT event_type, entity_type FROM events WHERE workspace_id = ? ORDER BY created_at ASC",
      [ws!.id],
    );
    expect(rows.length).toBeGreaterThan(0);
    const types = rows.map((r) => r.event_type);
    expect(types).toContain("workspace.created");
    expect(types).toContain("project.created");
    expect(types).toContain("work_item.created");
    expect(types).toContain("feature.created");
    expect(types).toContain("work_item.status_changed");
    expect(types).toContain("feature.status_changed");
  });

  it("enforces workspace isolation on work item lookup", async () => {
    const ws1 = await workspaceService.getBySlug(db, "smoke-ws");
    const projects1 = await projectService.list(db, ws1!.id);
    const project1 = projects1[0]!;
    const wi = await workItemService.create(db, SOLO_ACTOR, ws1!.id, project1.id, {
      title: "isolated work item",
    });

    const ws2 = await workspaceService.create(db, SOLO_ACTOR, {
      slug: "smoke-ws-2",
      name: "Second Workspace",
    });
    const fetched = await workItemService.get(db, ws2.id, wi.id);
    expect(fetched).toBeNull();
  });
});

/**
 * P02B domain tests — upsert merge logic for work items + todos.
 *
 * Covers the merge fingerprint branches:
 *   - create on miss
 *   - update on hit (same project + parent + lower(title))
 *   - noop on hit with no fields to merge
 *   - soft-deleted item with same fingerprint → new row (not revive)
 *   - workspace isolation
 *   - validation_error on empty title
 *   - update_todo_status expected_version narrow check + no-op same-status
 *
 * Same in-memory isolation pattern as the P01/P02A suites.
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
  workItemService,
  todoService,
  ConflictError,
  ValidationError,
  NotFoundError,
} from "@statehub/domain";

describe("P02B workItemService.upsert", () => {
  let db: DbClient;
  let wsId: string;
  let projectId: string;
  let featureId: string;

  beforeAll(async () => {
    db = createInMemoryDb();
    setDbClient(db);
    const ws = await workspaceService.create(db, SOLO_ACTOR, {
      slug: "p02b-wi-ws",
      name: "P02B WI",
    });
    wsId = ws.id;
    const project = await projectService.create(db, SOLO_ACTOR, wsId, {
      slug: "proj",
      name: "P",
      identifier: "PWB",
    });
    projectId = project.id;
    const feature = await featureService.create(db, SOLO_ACTOR, wsId, projectId, {
      name: "Feat",
      status: "in_progress",
    });
    featureId = feature.id;
  });

  it("creates a work item on first call (miss)", async () => {
    const actor = remoteMcpActor("opencode", "tok-1");
    const r = await workItemService.upsert(db, actor, wsId, projectId, {
      title: "Add backoff",
      featureId,
      priority: "high",
    });
    expect(r.action).toBe("created");
    expect(r.workItem.sequenceId).toBeGreaterThan(0);
    expect(`${r.workItem.projectIdentifier}-${r.workItem.sequenceId}`).toBe(
      `PWB-${r.workItem.sequenceId}`,
    );
    expect(r.workItem.source).toBe("remote_mcp");
    expect(r.workItem.confidence).toBe("low");
    expect(r.workItem.title).toBe("Add backoff");
  });

  it("merges on hit (same project + parent + lower(title)) — no new sequence_id", async () => {
    const actor = remoteMcpActor("opencode", "tok-2");
    const first = await workItemService.upsert(db, actor, wsId, projectId, {
      title: "Retry logic",
      featureId,
      priority: "medium",
    });
    const second = await workItemService.upsert(db, actor, wsId, projectId, {
      title: "retry logic", // case-insensitive
      featureId,
      priority: "high", // bump
      descriptionMarkdown: "added desc",
    });
    expect(second.action).toBe("updated");
    expect(second.workItem.id).toBe(first.workItem.id);
    expect(second.workItem.sequenceId).toBe(first.workItem.sequenceId);
    expect(second.workItem.priority).toBe("high");
    expect(second.workItem.descriptionMarkdown).toBe("added desc");
    expect(second.workItem.version).toBe(first.workItem.version + 1);
  });

  it("returns noop when the merge has no fields to update", async () => {
    const actor = remoteMcpActor("opencode", "tok-3");
    const first = await workItemService.upsert(db, actor, wsId, projectId, {
      title: "Noop target",
      featureId,
    });
    const second = await workItemService.upsert(db, actor, wsId, projectId, {
      title: "noop target",
      featureId,
      // no other fields → no merge sets
    });
    expect(second.action).toBe("noop");
    expect(second.workItem.id).toBe(first.workItem.id);
    expect(second.workItem.version).toBe(first.workItem.version);
  });

  it("creates a new row when a soft-deleted item has the same fingerprint (no revive)", async () => {
    const actor = remoteMcpActor("opencode", "tok-4");
    const first = await workItemService.upsert(db, actor, wsId, projectId, {
      title: "Softdelete me",
      featureId,
    });
    await workItemService.softDelete(db, actor, wsId, first.workItem.id);
    const second = await workItemService.upsert(db, actor, wsId, projectId, {
      title: "softdelete me",
      featureId,
    });
    expect(second.action).toBe("created");
    expect(second.workItem.id).not.toBe(first.workItem.id);
    expect(second.workItem.sequenceId).not.toBe(first.workItem.sequenceId);
  });

  it("rejects empty title with ValidationError", async () => {
    const actor = remoteMcpActor("opencode", "tok-5");
    await expect(
      workItemService.upsert(db, actor, wsId, projectId, { title: "  " }),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects a feature_id that doesn't belong to the workspace", async () => {
    const actor = remoteMcpActor("opencode", "tok-6");
    await expect(
      workItemService.upsert(db, actor, wsId, projectId, {
        title: "Bad parent",
        featureId: "ftr_nonexistent",
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("isolates by workspace — a different workspace can't see the upserted item", async () => {
    const actor = remoteMcpActor("opencode", "tok-7");
    const other = await workspaceService.create(db, SOLO_ACTOR, {
      slug: "p02b-wi-other",
      name: "Other",
    });
    const otherProj = await projectService.create(db, SOLO_ACTOR, other.id, {
      slug: "otherproj",
      name: "OP",
      identifier: "OPW",
    });
    const r = await workItemService.upsert(db, actor, other.id, otherProj.id, {
      title: "Other ws item",
    });
    // Cross-workspace get returns null.
    expect(await workItemService.get(db, wsId, r.workItem.id)).toBeNull();
    expect(await workItemService.get(db, other.id, r.workItem.id)).not.toBeNull();
  });
});

describe("P02B todoService.upsert", () => {
  let db: DbClient;
  let wsId: string;
  let projectId: string;
  let featureId: string;
  let workItemId: string;

  beforeAll(async () => {
    db = createInMemoryDb();
    setDbClient(db);
    const ws = await workspaceService.create(db, SOLO_ACTOR, {
      slug: "p02b-td-ws",
      name: "P02B TD",
    });
    wsId = ws.id;
    const project = await projectService.create(db, SOLO_ACTOR, wsId, {
      slug: "proj",
      name: "P",
      identifier: "PTD",
    });
    projectId = project.id;
    const feature = await featureService.create(db, SOLO_ACTOR, wsId, projectId, {
      name: "Feat",
      status: "in_progress",
    });
    featureId = feature.id;
    const wi = await workItemService.create(db, SOLO_ACTOR, wsId, projectId, {
      title: "Parent WI",
      featureId,
    });
    workItemId = wi.id;
  });

  it("creates a todo on first call (miss) with status='backlog'", async () => {
    const actor = remoteMcpActor("opencode", "tok-1");
    const r = await todoService.upsert(db, actor, wsId, {
      projectId,
      workItemId,
      title: "Write tests",
      evidenceRequired: 1,
    });
    expect(r.action).toBe("created");
    expect(r.todo.status).toBe("backlog");
    expect(r.todo.source).toBe("remote_mcp");
    expect(r.todo.confidence).toBe("low");
    expect(r.todo.evidenceRequired).toBe(1);
  });

  it("merges on hit (same project + work_item + lower(title))", async () => {
    const actor = remoteMcpActor("opencode", "tok-2");
    const first = await todoService.upsert(db, actor, wsId, {
      projectId,
      workItemId,
      title: "Add logging",
      priority: "medium",
    });
    const second = await todoService.upsert(db, actor, wsId, {
      projectId,
      workItemId,
      title: "add logging",
      priority: "high",
      description: "added desc",
    });
    expect(second.action).toBe("updated");
    expect(second.todo.id).toBe(first.todo.id);
    expect(second.todo.priority).toBe("high");
    expect(second.todo.description).toBe("added desc");
    expect(second.todo.version).toBe(first.todo.version + 1);
  });

  it("returns noop when the merge has no fields to update", async () => {
    const actor = remoteMcpActor("opencode", "tok-3");
    const first = await todoService.upsert(db, actor, wsId, {
      projectId,
      workItemId,
      title: "Noop todo",
    });
    const second = await todoService.upsert(db, actor, wsId, {
      projectId,
      workItemId,
      title: "noop todo",
    });
    expect(second.action).toBe("noop");
    expect(second.todo.id).toBe(first.todo.id);
    expect(second.todo.version).toBe(first.todo.version);
  });

  it("rejects empty title with ValidationError", async () => {
    const actor = remoteMcpActor("opencode", "tok-4");
    await expect(
      todoService.upsert(db, actor, wsId, { projectId, workItemId, title: "" }),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects a work_item_id that doesn't belong to the workspace", async () => {
    const actor = remoteMcpActor("opencode", "tok-5");
    await expect(
      todoService.upsert(db, actor, wsId, {
        projectId,
        workItemId: "wi_nonexistent",
        title: "Bad parent",
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("treats feature-scoped and work-item-scoped todos with the same title as distinct", async () => {
    const actor = remoteMcpActor("opencode", "tok-6");
    const featureScoped = await todoService.upsert(db, actor, wsId, {
      projectId,
      featureId,
      title: "Shared title",
    });
    const wiScoped = await todoService.upsert(db, actor, wsId, {
      projectId,
      workItemId,
      title: "Shared title",
    });
    expect(featureScoped.action).toBe("created");
    expect(wiScoped.action).toBe("created");
    expect(featureScoped.todo.id).not.toBe(wiScoped.todo.id);
  });
});

describe("P02B todoService.updateStatus — expected_version + no-op", () => {
  let db: DbClient;
  let wsId: string;
  let projectId: string;
  let todoId: string;

  beforeAll(async () => {
    db = createInMemoryDb();
    setDbClient(db);
    const ws = await workspaceService.create(db, SOLO_ACTOR, {
      slug: "p02b-ts-ws",
      name: "P02B TS",
    });
    wsId = ws.id;
    const project = await projectService.create(db, SOLO_ACTOR, wsId, {
      slug: "proj",
      name: "P",
      identifier: "PTS",
    });
    projectId = project.id;
    const feature = await featureService.create(db, SOLO_ACTOR, wsId, projectId, {
      name: "Feat",
      status: "in_progress",
    });
    const actor = remoteMcpActor("opencode", "tok-setup");
    const r = await todoService.upsert(db, actor, wsId, {
      projectId,
      featureId: feature.id,
      title: "Status target",
    });
    todoId = r.todo.id;
  });

  it("returns the same todo (no version bump) when status is unchanged", async () => {
    const before = await todoService.get(db, wsId, todoId);
    const after = await todoService.updateStatus(db, SOLO_ACTOR, wsId, todoId, {
      status: "backlog", // same as current
    });
    expect(after.version).toBe(before!.version);
    expect(after.updatedAt).toBe(before!.updatedAt);
  });

  it("flips status to in_progress and bumps version", async () => {
    const before = await todoService.get(db, wsId, todoId);
    const after = await todoService.updateStatus(db, SOLO_ACTOR, wsId, todoId, {
      status: "in_progress",
    });
    expect(after.status).toBe("in_progress");
    expect(after.version).toBe(before!.version + 1);
  });

  it("rejects with ConflictError when expected_version mismatches", async () => {
    const current = await todoService.get(db, wsId, todoId);
    await expect(
      todoService.updateStatus(db, SOLO_ACTOR, wsId, todoId, {
        status: "done",
        expectedVersion: current!.version + 999,
        evidenceSummary: "n/a",
      }),
    ).rejects.toThrow(ConflictError);
  });

  it("accepts expected_version when it matches", async () => {
    const current = await todoService.get(db, wsId, todoId);
    const after = await todoService.updateStatus(db, SOLO_ACTOR, wsId, todoId, {
      status: "done",
      expectedVersion: current!.version,
      evidenceSummary: "all good",
    });
    expect(after.status).toBe("done");
    expect(after.completedAt).not.toBeNull();
  });

  it("rejects reopening a done todo with ConflictError", async () => {
    await expect(
      todoService.updateStatus(db, SOLO_ACTOR, wsId, todoId, {
        status: "in_progress",
      }),
    ).rejects.toThrow(ConflictError);
  });
});

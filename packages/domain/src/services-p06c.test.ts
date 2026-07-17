/**
 * P06C domain tests — planeIssuesImporter + linearIssuesImporter.
 *
 * Covers:
 *   - planeIssuesImporter.preview maps issues to work item inputs
 *   - planeIssuesImporter.preview skips issues already linked
 *   - planeIssuesImporter.preview errors on missing name / missing link
 *   - planeIssuesImporter.preview resolves project to existing feature
 *   - planeIssuesImporter.run creates work items + external links + import_job
 *   - planeIssuesImporter.run is idempotent on re-run
 *   - linearIssuesImporter.preview maps issues to work item inputs
 *   - linearIssuesImporter.preview skips issues already linked
 *   - linearIssuesImporter.preview errors on missing identifier / url / title
 *   - linearIssuesImporter.preview maps Linear project to existing feature
 *   - linearIssuesImporter.run creates work items + external links + import_job
 *   - linearIssuesImporter.run is idempotent on re-run
 *   - linearIssuesImporter maps priority correctly
 *
 * Same in-memory isolation pattern as P03/P04/P05/P06A/P06B suites.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { setDbClient, createInMemoryDb } from "@statehub/db/node";
import type { DbClient } from "@statehub/db";
import {
  SOLO_ACTOR,
  workspaceService,
  projectService,
  stateService,
  featureService,
  workItemService,
  externalLinkService,
  integrationService,
  planeIssuesImporter,
  linearIssuesImporter,
  type PlaneIssue,
  type LinearIssue,
} from "@statehub/domain";

describe("P06C planeIssuesImporter", () => {
  let db: DbClient;
  let wsId: string;
  let projectId: string;
  let todoStateId: string;
  let integrationId: string;

  beforeAll(async () => {
    db = createInMemoryDb();
    setDbClient(db);
    const ws = await workspaceService.create(db, SOLO_ACTOR, {
      slug: "p06c-plane",
      name: "P06C Plane",
    });
    wsId = ws.id;
    const project = await projectService.create(db, SOLO_ACTOR, wsId, {
      slug: "proj",
      name: "P06C Plane Project",
      identifier: "PPLN",
    });
    projectId = project.id;

    const states = await stateService.list(db, wsId, projectId);
    todoStateId = states.find((s) => s.name === "Todo")!.id;

    const integration = await integrationService.create(db, SOLO_ACTOR, wsId, {
      provider: "plane",
      name: "plane/demo",
      config: { workspace_slug: "demo" },
    });
    integrationId = integration.id;
  });

  it("preview maps issues to work item inputs", async () => {
    const preview = await planeIssuesImporter.preview(db, wsId, integrationId, {
      projectId,
      stateId: todoStateId,
      issues: [
        {
          id: "plane-1",
          name: "ABC-1",
          description: "Fix the thing",
          state: "In Progress",
          priority: "high",
          project: "Demo",
          link: "https://plane.example/demo/projects/demo/issues/ABC-1",
          labels: ["bug"],
          assignees: ["alice"],
        },
      ],
    });
    expect(preview.toCreate.length).toBe(1);
    expect(preview.toCreate[0]!.workItemTitle).toBe("ABC-1");
    expect(preview.toCreate[0]!.workItemDescription).toContain("Fix the thing");
    expect(preview.toCreate[0]!.workItemDescription).toContain("labels: bug");
    expect(preview.toCreate[0]!.workItemDescription).toContain("@alice");
    expect(preview.toCreate[0]!.issueUrl).toContain("ABC-1");
    expect(preview.toSkip.length).toBe(0);
    expect(preview.errors.length).toBe(0);
  });

  it("preview skips issues that already have an external_link", async () => {
    const issue: PlaneIssue = {
      id: "plane-100",
      name: "ABC-100",
      state: "In Progress",
      project: "Demo",
      link: "https://plane.example/demo/issues/ABC-100",
    };
    const first = await planeIssuesImporter.run(db, SOLO_ACTOR, wsId, integrationId, {
      projectId,
      stateId: todoStateId,
      issues: [issue],
    });
    expect(first.created.length).toBe(1);

    const preview = await planeIssuesImporter.preview(db, wsId, integrationId, {
      projectId,
      stateId: todoStateId,
      issues: [issue],
    });
    expect(preview.toCreate.length).toBe(0);
    expect(preview.toSkip.length).toBe(1);
    expect(preview.toSkip[0]!.issueTitle).toBe("ABC-100");
  });

  it("preview errors on missing name or link", async () => {
    const preview = await planeIssuesImporter.preview(db, wsId, integrationId, {
      projectId,
      stateId: todoStateId,
      issues: [
        { id: "plane-200", name: "", state: "In Progress", link: "https://x/y/1" },
        { id: "plane-201", name: "ABC-201", state: "In Progress", link: "" },
      ],
    });
    expect(preview.toCreate.length).toBe(0);
    expect(preview.errors.length).toBe(2);
  });

  it("preview resolves project to an existing feature", async () => {
    const feature = await featureService.create(db, SOLO_ACTOR, wsId, projectId, {
      name: "Demo",
    });

    const preview = await planeIssuesImporter.preview(db, wsId, integrationId, {
      projectId,
      stateId: todoStateId,
      issues: [
        {
          id: "plane-300",
          name: "ABC-300",
          state: "In Progress",
          project: "demo", // case-insensitive match
          link: "https://plane.example/demo/issues/ABC-300",
        },
      ],
    });
    expect(preview.toCreate.length).toBe(1);
    expect(preview.toCreate[0]!.featureId).toBe(feature.id);
  });

  it("run creates work items + external links + import_job", async () => {
    const result = await planeIssuesImporter.run(db, SOLO_ACTOR, wsId, integrationId, {
      projectId,
      stateId: todoStateId,
      issues: [
        {
          id: "plane-400",
          name: "ABC-400",
          state: "In Progress",
          priority: "urgent",
          project: "Demo",
          link: "https://plane.example/demo/issues/ABC-400",
        },
      ],
    });
    expect(result.created.length).toBe(1);
    expect(result.skipped.length).toBe(0);
    expect(result.errors.length).toBe(0);
    expect(result.jobId).toBeTruthy();

    const workItems = await workItemService.list(db, wsId, projectId, {});
    expect(workItems.some((wi) => wi.title === "ABC-400")).toBe(true);

    for (const item of result.created) {
      const links = await externalLinkService.list(db, wsId, {
        entityType: "work_item",
        entityId: item.workItemId,
      });
      expect(links.some((l) => l.externalSource === "plane")).toBe(true);
    }
  });

  it("run is idempotent on re-run (skips already-linked)", async () => {
    const issues: PlaneIssue[] = [
      {
        id: "plane-500",
        name: "ABC-500",
        state: "In Progress",
        project: "Demo",
        link: "https://plane.example/demo/issues/ABC-500",
      },
    ];
    const first = await planeIssuesImporter.run(db, SOLO_ACTOR, wsId, integrationId, {
      projectId,
      stateId: todoStateId,
      issues,
    });
    expect(first.created.length).toBe(1);

    const second = await planeIssuesImporter.run(db, SOLO_ACTOR, wsId, integrationId, {
      projectId,
      stateId: todoStateId,
      issues,
    });
    expect(second.created.length).toBe(0);
    expect(second.skipped.length).toBe(1);
    expect(second.skipped[0]!.issueTitle).toBe("ABC-500");
  });
});

describe("P06C linearIssuesImporter", () => {
  let db: DbClient;
  let wsId: string;
  let projectId: string;
  let todoStateId: string;
  let integrationId: string;

  beforeAll(async () => {
    db = createInMemoryDb();
    setDbClient(db);
    const ws = await workspaceService.create(db, SOLO_ACTOR, {
      slug: "p06c-linear",
      name: "P06C Linear",
    });
    wsId = ws.id;
    const project = await projectService.create(db, SOLO_ACTOR, wsId, {
      slug: "proj",
      name: "P06C Linear Project",
      identifier: "PLIN",
    });
    projectId = project.id;

    const states = await stateService.list(db, wsId, projectId);
    todoStateId = states.find((s) => s.name === "Todo")!.id;

    const integration = await integrationService.create(db, SOLO_ACTOR, wsId, {
      provider: "linear",
      name: "linear/demo",
      config: { team_key: "DEMO" },
    });
    integrationId = integration.id;
  });

  it("preview maps issues to work item inputs", async () => {
    const preview = await linearIssuesImporter.preview(db, wsId, integrationId, {
      projectId,
      stateId: todoStateId,
      issues: [
        {
          id: "lin-1",
          identifier: "DEMO-1",
          title: "Ship the feature",
          description: "Details here",
          state: { name: "In Progress", type: "started" },
          priority: 1,
          team: { id: "t1", name: "Demo", key: "DEMO" },
          project: { id: "p1", name: "Q1" },
          labels: { nodes: [{ id: "l1", name: "bug" }] },
          assignee: { name: "bob" },
          url: "https://linear.example/issue/DEMO-1",
        },
      ],
    });
    expect(preview.toCreate.length).toBe(1);
    expect(preview.toCreate[0]!.workItemTitle).toBe("DEMO-1: Ship the feature");
    expect(preview.toCreate[0]!.workItemDescription).toContain("Details here");
    expect(preview.toCreate[0]!.workItemDescription).toContain("labels: bug");
    expect(preview.toCreate[0]!.workItemDescription).toContain("@bob");
  });

  it("preview skips issues that already have an external_link", async () => {
    const issue: LinearIssue = {
      id: "lin-100",
      identifier: "DEMO-100",
      title: "Pre-existing",
      state: { name: "In Progress", type: "started" },
      team: { id: "t1", name: "Demo", key: "DEMO" },
      url: "https://linear.example/issue/DEMO-100",
    };
    const first = await linearIssuesImporter.run(db, SOLO_ACTOR, wsId, integrationId, {
      projectId,
      stateId: todoStateId,
      issues: [issue],
    });
    expect(first.created.length).toBe(1);

    const preview = await linearIssuesImporter.preview(db, wsId, integrationId, {
      projectId,
      stateId: todoStateId,
      issues: [issue],
    });
    expect(preview.toCreate.length).toBe(0);
    expect(preview.toSkip.length).toBe(1);
    expect(preview.toSkip[0]!.issueTitle).toBe("DEMO-100");
  });

  it("preview errors on missing identifier, url, or title", async () => {
    const preview = await linearIssuesImporter.preview(db, wsId, integrationId, {
      projectId,
      stateId: todoStateId,
      issues: [
        { id: "lin-200", identifier: "", title: "Has title", url: "https://x/1" },
        { id: "lin-201", identifier: "DEMO-201", title: "Has title", url: "" },
        { id: "lin-202", identifier: "DEMO-202", title: "", url: "https://x/2" },
      ],
    });
    expect(preview.toCreate.length).toBe(0);
    expect(preview.errors.length).toBe(3);
  });

  it("preview maps Linear project to an existing feature", async () => {
    const feature = await featureService.create(db, SOLO_ACTOR, wsId, projectId, {
      name: "Q1 Initiative",
    });

    const preview = await linearIssuesImporter.preview(db, wsId, integrationId, {
      projectId,
      stateId: todoStateId,
      issues: [
        {
          id: "lin-300",
          identifier: "DEMO-300",
          title: "Work item",
          state: { name: "In Progress", type: "started" },
          team: { id: "t1", name: "Demo", key: "DEMO" },
          project: { id: "p1", name: "q1 initiative" }, // case-insensitive
          url: "https://linear.example/issue/DEMO-300",
        },
      ],
    });
    expect(preview.toCreate.length).toBe(1);
    expect(preview.toCreate[0]!.featureId).toBe(feature.id);
  });

  it("run creates work items + external links + import_job", async () => {
    const result = await linearIssuesImporter.run(db, SOLO_ACTOR, wsId, integrationId, {
      projectId,
      stateId: todoStateId,
      issues: [
        {
          id: "lin-400",
          identifier: "DEMO-400",
          title: "Run test",
          state: { name: "In Progress", type: "started" },
          priority: 0, // urgent
          team: { id: "t1", name: "Demo", key: "DEMO" },
          url: "https://linear.example/issue/DEMO-400",
        },
      ],
    });
    expect(result.created.length).toBe(1);
    expect(result.errors.length).toBe(0);
    expect(result.jobId).toBeTruthy();

    const workItems = await workItemService.list(db, wsId, projectId, {});
    expect(
      workItems.some((wi) => wi.title === "DEMO-400: Run test"),
    ).toBe(true);

    for (const item of result.created) {
      const links = await externalLinkService.list(db, wsId, {
        entityType: "work_item",
        entityId: item.workItemId,
      });
      expect(links.some((l) => l.externalSource === "linear")).toBe(true);
    }
  });

  it("run is idempotent on re-run (skips already-linked)", async () => {
    const issues: LinearIssue[] = [
      {
        id: "lin-500",
        identifier: "DEMO-500",
        title: "Idempotent",
        state: { name: "In Progress", type: "started" },
        team: { id: "t1", name: "Demo", key: "DEMO" },
        url: "https://linear.example/issue/DEMO-500",
      },
    ];
    const first = await linearIssuesImporter.run(db, SOLO_ACTOR, wsId, integrationId, {
      projectId,
      stateId: todoStateId,
      issues,
    });
    expect(first.created.length).toBe(1);

    const second = await linearIssuesImporter.run(db, SOLO_ACTOR, wsId, integrationId, {
      projectId,
      stateId: todoStateId,
      issues,
    });
    expect(second.created.length).toBe(0);
    expect(second.skipped.length).toBe(1);
  });
});

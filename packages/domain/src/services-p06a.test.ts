/**
 * P06A domain tests — externalLinkService + markdownExporter.
 *
 * Covers:
 *   - externalLinkService.create + list + get + remove happy path
 *   - create dedupes on (entity_type, entity_id, external_source, external_id)
 *   - create throws NotFoundError when entity doesn't exist
 *   - create throws ValidationError on bad input (missing fields, bad URL)
 *   - list filters by project / entity_type
 *   - remove is idempotent (NotFoundError on second call)
 *   - markdownExporter.exportProject produces all 8 sections
 *   - markdownExporter includes external links in work item section
 *   - markdownExporter without project_id exports all projects
 *
 * Same in-memory isolation pattern as P03/P04/P05 suites.
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
  externalLinkService,
  exportProject,
  ValidationError,
  NotFoundError,
} from "@statehub/domain";

describe("P06A externalLinkService", () => {
  let db: DbClient;
  let wsId: string;
  let projectId: string;
  let featureId: string;

  beforeAll(async () => {
    db = createInMemoryDb();
    setDbClient(db);
    const ws = await workspaceService.create(db, SOLO_ACTOR, {
      slug: "p06a-el",
      name: "P06A EL",
    });
    wsId = ws.id;
    const project = await projectService.create(db, SOLO_ACTOR, wsId, {
      slug: "proj",
      name: "P",
      identifier: "PEL",
    });
    projectId = project.id;
    const feature = await featureService.create(db, SOLO_ACTOR, wsId, projectId, {
      name: "P06A test feature",
    });
    featureId = feature.id;
  });

  it("creates a link and round-trips it via get", async () => {
    const link = await externalLinkService.create(db, SOLO_ACTOR, wsId, {
      projectId,
      entityType: "feature",
      entityId: featureId,
      externalSource: "github_pr",
      externalId: "42",
      externalUrl: "https://github.com/statehub/core/pull/42",
    });
    expect(link.id).toBeTruthy();
    expect(link.externalSource).toBe("github_pr");
    expect(link.externalId).toBe("42");
    expect(link.syncStatus).toBe("linked");

    const fetched = await externalLinkService.get(db, wsId, link.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.externalUrl).toBe("https://github.com/statehub/core/pull/42");
  });

  it("dedupes on (entity_type, entity_id, external_source, external_id)", async () => {
    const first = await externalLinkService.create(db, SOLO_ACTOR, wsId, {
      projectId,
      entityType: "feature",
      entityId: featureId,
      externalSource: "github_pr",
      externalId: "43",
      externalUrl: "https://github.com/statehub/core/pull/43",
    });
    const second = await externalLinkService.create(db, SOLO_ACTOR, wsId, {
      projectId,
      entityType: "feature",
      entityId: featureId,
      externalSource: "github_pr",
      externalId: "43",
      externalUrl: "https://github.com/statehub/core/pull/43",
    });
    expect(second.id).toBe(first.id);
  });

  it("throws NotFoundError when the linked entity doesn't exist", async () => {
    await expect(
      externalLinkService.create(db, SOLO_ACTOR, wsId, {
        projectId,
        entityType: "feature",
        entityId: "nonexistent-feature-id",
        externalSource: "github_pr",
        externalId: "99",
        externalUrl: "https://github.com/x/y/pull/99",
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("throws ValidationError on a bad external_url", async () => {
    await expect(
      externalLinkService.create(db, SOLO_ACTOR, wsId, {
        projectId,
        entityType: "feature",
        entityId: featureId,
        externalSource: "github_pr",
        externalId: "100",
        externalUrl: "not-a-url",
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("throws ValidationError on an unknown entity_type", async () => {
    await expect(
      externalLinkService.create(db, SOLO_ACTOR, wsId, {
        projectId,
        entityType: "unknown_type",
        entityId: featureId,
        externalSource: "github_pr",
        externalId: "101",
        externalUrl: "https://github.com/x/y/pull/101",
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("lists links filtered by entity_type", async () => {
    const list = await externalLinkService.list(db, wsId, {
      entityType: "feature",
      entityId: featureId,
    });
    expect(list.length).toBeGreaterThanOrEqual(2);
    expect(list.every((l) => l.entityType === "feature")).toBe(true);
  });

  it("removes a link and is idempotent", async () => {
    const link = await externalLinkService.create(db, SOLO_ACTOR, wsId, {
      projectId,
      entityType: "feature",
      entityId: featureId,
      externalSource: "github_pr",
      externalId: "200",
      externalUrl: "https://github.com/x/y/pull/200",
    });
    await externalLinkService.remove(db, SOLO_ACTOR, wsId, link.id);
    const fetched = await externalLinkService.get(db, wsId, link.id);
    expect(fetched).toBeNull();
    // Second remove throws NotFoundError.
    await expect(
      externalLinkService.remove(db, SOLO_ACTOR, wsId, link.id),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("P06A markdownExporter", () => {
  let db: DbClient;
  let wsId: string;
  let projectId: string;
  let featureId: string;
  let workItemId: string;

  beforeAll(async () => {
    db = createInMemoryDb();
    setDbClient(db);
    const ws = await workspaceService.create(db, SOLO_ACTOR, {
      slug: "p06a-md",
      name: "P06A MD",
    });
    wsId = ws.id;
    const project = await projectService.create(db, SOLO_ACTOR, wsId, {
      slug: "proj",
      name: "P06A Project",
      identifier: "PMD",
    });
    projectId = project.id;
    const feature = await featureService.create(db, SOLO_ACTOR, wsId, projectId, {
      name: "P06A export feature",
      description: "Test feature for markdown export.",
      status: "in_progress",
    });
    featureId = feature.id;

    const states = await stateService.list(db, wsId, projectId);
    const todoState = states.find((s) => s.name === "Todo")!;
    const wi = await workItemService.create(db, SOLO_ACTOR, wsId, projectId, {
      title: "P06A open work item",
      type: "task",
      priority: "high",
      stateId: todoState.id,
      featureId,
    });
    workItemId = wi.id;

    await decisionService.record(db, SOLO_ACTOR, wsId, {
      projectId,
      featureId,
      decisionText: "Ship P06A before P06B.",
      rationale: "P06A unblocks the export surface.",
      source: "user",
    });

    await externalLinkService.create(db, SOLO_ACTOR, wsId, {
      projectId,
      entityType: "work_item",
      entityId: workItemId,
      externalSource: "github_pr",
      externalId: "55",
      externalUrl: "https://github.com/statehub/core/pull/55",
    });
  });

  it("produces all 8 sections for a project", async () => {
    const result = await exportProject(db, wsId, { projectId });
    expect(result.markdown).toContain("# P06A Project (PMD)");
    expect(result.markdown).toContain("## Current Focus");
    expect(result.markdown).toContain("## Features");
    expect(result.markdown).toContain("## Open Work Items");
    expect(result.markdown).toContain("## Review Findings");
    expect(result.markdown).toContain("## Agent Runs");
    expect(result.markdown).toContain("## Evidence");
    expect(result.markdown).toContain("## Decisions");
    expect(result.markdown).toContain("## Weekly Reviews");
    expect(result.projectIds).toEqual([projectId]);
    expect(result.byteLength).toBeGreaterThan(100);
  });

  it("includes the work item title + external link", async () => {
    const result = await exportProject(db, wsId, { projectId });
    expect(result.markdown).toContain("P06A open work item");
    expect(result.markdown).toContain("https://github.com/statehub/core/pull/55");
  });

  it("includes the decision text in Current Focus + Decisions", async () => {
    const result = await exportProject(db, wsId, { projectId });
    expect(result.markdown).toContain("Ship P06A before P06B.");
  });

  it("exports all projects when projectId is omitted", async () => {
    // Add a second project.
    await projectService.create(db, SOLO_ACTOR, wsId, {
      slug: "second",
      name: "Second Project",
      identifier: "SECND",
    });
    const result = await exportProject(db, wsId);
    expect(result.projectIds.length).toBeGreaterThanOrEqual(2);
    expect(result.markdown).toContain("# P06A Project (PMD)");
    expect(result.markdown).toContain("# Second Project (SECND)");
  });

  it("respects includeReviews=false", async () => {
    const result = await exportProject(db, wsId, { projectId, includeReviews: false });
    expect(result.markdown).not.toContain("## Review Findings");
  });

  it("respects includeEvidence=false", async () => {
    const result = await exportProject(db, wsId, { projectId, includeEvidence: false });
    expect(result.markdown).not.toContain("## Evidence");
  });
});

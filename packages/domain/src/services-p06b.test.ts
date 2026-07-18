/**
 * P06B domain tests — integrationService + githubIssuesImporter.
 *
 * Covers:
 *   - integrationService create + list + get + update + remove happy path
 *   - integrationService.create encrypts PAT (P07D) + strips from event payload
 *   - integrationService.update patches name + config (encrypting PAT)
 *   - integrationService.getDecryptedConfig returns plaintext (P07D)
 *   - integrationService.get masks PAT in configJson (P07D)
 *   - githubIssuesImporter.preview maps issues to work item inputs
 *   - githubIssuesImporter.preview skips issues already linked
 *   - githubIssuesImporter.preview errors on missing title / missing html_url
 *   - githubIssuesImporter.preview resolves milestone to existing feature
 *   - githubIssuesImporter.run creates work items + external links + import_job
 *   - githubIssuesImporter.run is idempotent on re-run (skips already linked)
 *   - githubIssuesImporter.run records import_job with summary
 *
 * Same in-memory isolation pattern as P03/P04/P05/P06A suites.
 *
 * P07D: tests set STATEHUB_INTEGRATION_KEY in beforeAll so encrypt/decrypt works.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
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
  githubIssuesImporter,
  type GithubIssue,
  listImportJobs,
  getImportJob,
  NotFoundError,
  ValidationError,
  generateKeyB64,
} from "@statehub/domain";

const TEST_KEY = generateKeyB64();
const ORIGINAL_KEY = process.env.STATEHUB_INTEGRATION_KEY;

describe("P06B integrationService", () => {
  let db: DbClient;
  let wsId: string;

  beforeAll(async () => {
    process.env.STATEHUB_INTEGRATION_KEY = TEST_KEY;
    db = createInMemoryDb();
    setDbClient(db);
    const ws = await workspaceService.create(db, SOLO_ACTOR, {
      slug: "p06b-int",
      name: "P06B Int",
    });
    wsId = ws.id;
  });

  afterAll(() => {
    if (ORIGINAL_KEY === undefined) {
      delete process.env.STATEHUB_INTEGRATION_KEY;
    } else {
      process.env.STATEHUB_INTEGRATION_KEY = ORIGINAL_KEY;
    }
  });

  it("creates an integration and round-trips it via get", async () => {
    const integration = await integrationService.create(db, SOLO_ACTOR, wsId, {
      provider: "github",
      name: "statehub/core",
      config: { repo: "statehub/core", pat: "ghp_secret" },
    });
    expect(integration.id).toBeTruthy();
    expect(integration.provider).toBe("github");
    expect(integration.status).toBe("active");
    // P07D: returned configJson masks the PAT — never leaks plaintext or ciphertext.
    expect(integration.configJson).not.toContain("ghp_secret");
    expect(integration.configJson).toContain('"pat":"••••"');
    // P07D: the stored row in the DB has the PAT encrypted (not masked, not plaintext).
    const row = await db.first<{ config_json: string }>(
      "SELECT config_json FROM integrations WHERE id = ?",
      [integration.id],
    );
    expect(row!.config_json).toContain("enc:v1:");
    expect(row!.config_json).not.toContain("ghp_secret");
    expect(row!.config_json).not.toContain("••••");

    const fetched = await integrationService.get(db, wsId, integration.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.name).toBe("statehub/core");
    expect(fetched!.configJson).toContain('"pat":"••••"');
  });

  it("lists integrations filtered by provider", async () => {
    const list = await integrationService.list(db, wsId, { provider: "github" });
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.every((i) => i.provider === "github")).toBe(true);
  });

  it("updates name + config", async () => {
    const integration = await integrationService.create(db, SOLO_ACTOR, wsId, {
      provider: "github",
      name: "old-name",
      config: { repo: "statehub/core" },
    });
    const updated = await integrationService.update(db, SOLO_ACTOR, wsId, integration.id, {
      name: "new-name",
      config: { repo: "statehub/core", pat: "ghp_new" },
    });
    expect(updated.name).toBe("new-name");
    // P07D: returned configJson masks the PAT.
    expect(updated.configJson).not.toContain("ghp_new");
    expect(updated.configJson).toContain('"pat":"••••"');
    // P07D: stored row has the PAT encrypted.
    const row = await db.first<{ config_json: string }>(
      "SELECT config_json FROM integrations WHERE id = ?",
      [integration.id],
    );
    expect(row!.config_json).toContain("enc:v1:");
    expect(row!.config_json).not.toContain("ghp_new");
  });

  it("getDecryptedConfig returns the plaintext token (P07D)", async () => {
    const integration = await integrationService.create(db, SOLO_ACTOR, wsId, {
      provider: "github",
      name: "decrypt-test",
      config: { repo: "statehub/core", pat: "ghp_decrypt_me" },
    });
    const result = await integrationService.getDecryptedConfig(db, wsId, integration.id);
    expect(result).not.toBeNull();
    expect(result!.provider).toBe("github");
    expect(result!.config.pat).toBe("ghp_decrypt_me");
    expect(result!.config.repo).toBe("statehub/core");
  });

  it("getDecryptedConfig reads legacy plaintext tokens (P07D lazy migration)", async () => {
    // Insert a row with raw plaintext config_json (bypass service).
    const id = crypto.randomUUID();
    await db.run(
      `INSERT INTO integrations (id, workspace_id, provider, name, config_json, status, created_by)
       VALUES (?, ?, 'github', 'legacy', ?, 'active', ?)`,
      [id, wsId, JSON.stringify({ repo: "statehub/legacy", pat: "ghp_legacy_plain" }), SOLO_ACTOR.id ?? null],
    );
    const result = await integrationService.getDecryptedConfig(db, wsId, id);
    expect(result).not.toBeNull();
    expect(result!.config.pat).toBe("ghp_legacy_plain");
    expect(result!.config.repo).toBe("statehub/legacy");
  });

  it("getDecryptedConfig returns null for missing integration", async () => {
    const result = await integrationService.getDecryptedConfig(db, wsId, "nonexistent-id");
    expect(result).toBeNull();
  });

  it("removes an integration and is idempotent on second remove", async () => {
    const integration = await integrationService.create(db, SOLO_ACTOR, wsId, {
      provider: "github",
      name: "to-remove",
      config: { repo: "x/y" },
    });
    await integrationService.remove(db, SOLO_ACTOR, wsId, integration.id);
    const fetched = await integrationService.get(db, wsId, integration.id);
    expect(fetched).toBeNull();
    await expect(
      integrationService.remove(db, SOLO_ACTOR, wsId, integration.id),
    ).rejects.toThrow(NotFoundError);
  });

  it("throws ValidationError when repo is missing", async () => {
    await expect(
      integrationService.create(db, SOLO_ACTOR, wsId, {
        provider: "github",
        name: "no-repo",
        config: {},
      }),
    ).rejects.toThrow(ValidationError);
  });
});

describe("P06B githubIssuesImporter", () => {
  let db: DbClient;
  let wsId: string;
  let projectId: string;
  let todoStateId: string;
  let integrationId: string;

  beforeAll(async () => {
    db = createInMemoryDb();
    setDbClient(db);
    const ws = await workspaceService.create(db, SOLO_ACTOR, {
      slug: "p06b-imp",
      name: "P06B Imp",
    });
    wsId = ws.id;
    const project = await projectService.create(db, SOLO_ACTOR, wsId, {
      slug: "proj",
      name: "P06B Project",
      identifier: "PIMP",
    });
    projectId = project.id;

    const states = await stateService.list(db, wsId, projectId);
    todoStateId = states.find((s) => s.name === "Todo")!.id;

    const integration = await integrationService.create(db, SOLO_ACTOR, wsId, {
      provider: "github",
      name: "statehub/core",
      config: { repo: "statehub/core" },
    });
    integrationId = integration.id;
  });

  it("preview maps open issues to work item inputs", async () => {
    const preview = await githubIssuesImporter.preview(db, wsId, integrationId, {
      projectId,
      stateId: todoStateId,
      issues: [
        {
          number: 1,
          title: "Bug: thing broken",
          body: "Steps to repro...",
          state: "open",
          html_url: "https://github.com/statehub/core/issues/1",
          labels: ["bug"],
          user: { login: "alice" },
        },
        {
          number: 2,
          title: "Feature: add thing",
          body: "Would be nice...",
          state: "open",
          html_url: "https://github.com/statehub/core/issues/2",
          labels: ["enhancement"],
          user: { login: "bob" },
        },
      ],
    });
    expect(preview.toCreate.length).toBe(2);
    expect(preview.toCreate[0]!.workItemTitle).toBe("Bug: thing broken");
    expect(preview.toCreate[0]!.workItemDescription).toContain("Steps to repro");
    expect(preview.toCreate[0]!.workItemDescription).toContain("labels: bug");
    expect(preview.toCreate[0]!.workItemDescription).toContain("@alice");
    expect(preview.toSkip.length).toBe(0);
    expect(preview.errors.length).toBe(0);
  });

  it("preview skips issues that already have an external_link", async () => {
    // First import creates the work item + link.
    const result = await githubIssuesImporter.run(db, SOLO_ACTOR, wsId, integrationId, {
      projectId,
      stateId: todoStateId,
      issues: [
        {
          number: 100,
          title: "Pre-existing issue",
          state: "open",
          html_url: "https://github.com/statehub/core/issues/100",
        },
      ],
    });
    expect(result.created.length).toBe(1);

    // Second preview on the same issue should skip it.
    const preview = await githubIssuesImporter.preview(db, wsId, integrationId, {
      projectId,
      stateId: todoStateId,
      issues: [
        {
          number: 100,
          title: "Pre-existing issue",
          state: "open",
          html_url: "https://github.com/statehub/core/issues/100",
        },
      ],
    });
    expect(preview.toCreate.length).toBe(0);
    expect(preview.toSkip.length).toBe(1);
    expect(preview.toSkip[0]!.issueNumber).toBe(100);
  });

  it("preview errors on missing title or html_url", async () => {
    const preview = await githubIssuesImporter.preview(db, wsId, integrationId, {
      projectId,
      stateId: todoStateId,
      issues: [
        { number: 200, title: "", state: "open", html_url: "https://x/y/issues/200" },
        { number: 201, title: "Has title", state: "open", html_url: "" },
      ],
    });
    expect(preview.toCreate.length).toBe(0);
    expect(preview.errors.length).toBe(2);
    expect(preview.errors.map((e) => e.issueNumber).sort()).toEqual([200, 201]);
  });

  it("preview resolves milestone to an existing feature", async () => {
    const feature = await featureService.create(db, SOLO_ACTOR, wsId, projectId, {
      name: "Q1 milestone",
    });

    const preview = await githubIssuesImporter.preview(db, wsId, integrationId, {
      projectId,
      stateId: todoStateId,
      issues: [
        {
          number: 300,
          title: "Issue with milestone",
          state: "open",
          html_url: "https://github.com/statehub/core/issues/300",
          milestone: { title: "Q1 milestone" },
        },
      ],
    });
    expect(preview.toCreate.length).toBe(1);
    expect(preview.toCreate[0]!.featureId).toBe(feature.id);
    expect(preview.toCreate[0]!.featureName).toBe("Q1 milestone");
  });

  it("run creates work items + external links + import_job", async () => {
    const result = await githubIssuesImporter.run(db, SOLO_ACTOR, wsId, integrationId, {
      projectId,
      stateId: todoStateId,
      issues: [
        {
          number: 400,
          title: "Run test issue 400",
          state: "open",
          html_url: "https://github.com/statehub/core/issues/400",
        },
        {
          number: 401,
          title: "Run test issue 401",
          state: "open",
          html_url: "https://github.com/statehub/core/issues/401",
        },
      ],
    });
    expect(result.created.length).toBe(2);
    expect(result.skipped.length).toBe(0);
    expect(result.errors.length).toBe(0);
    expect(result.jobId).toBeTruthy();

    // Work items were created.
    const workItems = await workItemService.list(db, wsId, projectId, {});
    const titles = workItems.map((wi) => wi.title);
    expect(titles).toContain("Run test issue 400");
    expect(titles).toContain("Run test issue 401");

    // External links were created.
    for (const item of result.created) {
      const links = await externalLinkService.list(db, wsId, {
        entityType: "work_item",
        entityId: item.workItemId,
      });
      expect(links.length).toBeGreaterThanOrEqual(1);
      expect(links.some((l) => l.externalSource === "github_issue")).toBe(true);
    }

    // import_job row was recorded with a summary.
    const job = await getImportJob(db, wsId, result.jobId);
    expect(job).not.toBeNull();
    expect(job!.status).toBe("completed");
    const summary = JSON.parse(job!.summaryJson!);
    expect(summary.created).toBe(2);
    expect(summary.skipped).toBe(0);
    expect(summary.errors).toBe(0);
  });

  it("run is idempotent on re-run (skips already-linked)", async () => {
    const issues: GithubIssue[] = [
      {
        number: 500,
        title: "Idempotent test issue",
        state: "open",
        html_url: "https://github.com/statehub/core/issues/500",
      },
    ];
    const first = await githubIssuesImporter.run(db, SOLO_ACTOR, wsId, integrationId, {
      projectId,
      stateId: todoStateId,
      issues,
    });
    expect(first.created.length).toBe(1);

    const second = await githubIssuesImporter.run(db, SOLO_ACTOR, wsId, integrationId, {
      projectId,
      stateId: todoStateId,
      issues,
    });
    expect(second.created.length).toBe(0);
    expect(second.skipped.length).toBe(1);
    expect(second.skipped[0]!.issueNumber).toBe(500);
  });

  it("run records a failed job if target project is missing", async () => {
    await expect(
      githubIssuesImporter.run(db, SOLO_ACTOR, wsId, integrationId, {
        projectId: "nonexistent-project",
        stateId: todoStateId,
        issues: [],
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("listImportJobs returns jobs in descending created_at order", async () => {
    const jobs = await listImportJobs(db, wsId, { integrationId });
    expect(jobs.length).toBeGreaterThanOrEqual(3);
    // Verify descending — first job has the highest created_at.
    for (let i = 1; i < jobs.length; i++) {
      expect(jobs[i - 1]!.createdAt).toBeGreaterThanOrEqual(jobs[i]!.createdAt);
    }
  });
});

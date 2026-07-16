/**
 * P04A domain tests — repoAliasService + localEvidenceService.ingest +
 * agentRunService git-field extensions + start/complete_agent_run_local
 * trust derivation.
 *
 * Covers:
 *   - repoAliasService.add/list/remove
 *   - repoAliasService.add rejects duplicates + same-as-repo_url
 *   - localEvidenceService.ingest:
 *       matched + dirty=false  → trusted
 *       matched + dirty=true   → working_tree
 *       alias_matched + clean  → trusted
 *       unknown                → untrusted
 *       repo_conflict (matches different project) → RepoConflictError
 *   - agentRunService.start persists git fields
 *   - agentRunService.complete with matching repo_remote_url + clean → trust_state=trusted
 *   - agentRunService.complete with no repo_remote_url → trust_state=working_tree (P02 compat)
 *
 * Same in-memory isolation pattern as P03 suites.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { setDbClient, createInMemoryDb } from "@statehub/db/node";
import type { DbClient } from "@statehub/db";
import {
  SOLO_ACTOR,
  workspaceService,
  projectService,
  featureService,
  agentRunService,
  repoAliasService,
  localEvidenceService,
  evidenceService,
  AlreadyExistsError,
  NotFoundError,
  RepoConflictError,
  ValidationError,
} from "@statehub/domain";
import { normalizeRepoUrl } from "@statehub/shared";

describe("P04A repoAliasService", () => {
  let db: DbClient;
  let wsId: string;
  let projectId: string;

  beforeAll(async () => {
    db = createInMemoryDb();
    setDbClient(db);
    const ws = await workspaceService.create(db, SOLO_ACTOR, {
      slug: "p04a-ws",
      name: "P04A",
    });
    wsId = ws.id;
    const project = await projectService.create(db, SOLO_ACTOR, wsId, {
      slug: "proj",
      name: "P",
      identifier: "PFA",
      repoUrl: "git@github.com:owner/kavis.git",
    });
    projectId = project.id;
  });

  it("add + list + remove a single alias", async () => {
    const alias = await repoAliasService.add(
      db,
      SOLO_ACTOR,
      wsId,
      projectId,
      "https://github.com/owner/kavis-fork",
    );
    expect(alias.aliasUrl).toBe("https://github.com/owner/kavis-fork");
    expect(alias.projectId).toBe(projectId);

    const list = await repoAliasService.list(db, wsId, projectId);
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(alias.id);

    await repoAliasService.remove(db, SOLO_ACTOR, wsId, projectId, alias.id);
    const after = await repoAliasService.list(db, wsId, projectId);
    expect(after).toHaveLength(0);
  });

  it("rejects an alias that matches the project's own repo_url", async () => {
    await expect(
      repoAliasService.add(db, SOLO_ACTOR, wsId, projectId, "git@github.com:owner/kavis.git"),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects a duplicate alias in the same workspace", async () => {
    const alias = await repoAliasService.add(
      db,
      SOLO_ACTOR,
      wsId,
      projectId,
      "https://github.com/owner/kavis-mirror",
    );
    await expect(
      repoAliasService.add(db, SOLO_ACTOR, wsId, projectId, "git@github.com:owner/kavis-mirror.git"),
    ).rejects.toThrow(AlreadyExistsError);
    await repoAliasService.remove(db, SOLO_ACTOR, wsId, projectId, alias.id);
  });

  it("remove on a missing alias throws NotFoundError", async () => {
    await expect(
      repoAliasService.remove(db, SOLO_ACTOR, wsId, projectId, "nope"),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("P04A localEvidenceService.ingest — trust derivation", () => {
  let db: DbClient;
  let wsId: string;
  let projectId: string;
  let featureId: string;
  const repoUrl = "git@github.com:owner/kavis.git";
  const aliasUrl = "https://github.com/owner/kavis-fork";

  beforeAll(async () => {
    db = createInMemoryDb();
    setDbClient(db);
    const ws = await workspaceService.create(db, SOLO_ACTOR, {
      slug: "p04a-ingest-ws",
      name: "P04A Ingest",
    });
    wsId = ws.id;
    const project = await projectService.create(db, SOLO_ACTOR, wsId, {
      slug: "proj",
      name: "P",
      identifier: "PFB",
      repoUrl,
    });
    projectId = project.id;
    // a second project for the repo_conflict test
    await projectService.create(db, SOLO_ACTOR, wsId, {
      slug: "other",
      name: "Other",
      identifier: "PFC",
      repoUrl: "git@github.com:owner/other.git",
    });
    const feature = await featureService.create(db, SOLO_ACTOR, wsId, projectId, {
      name: "P04A Feat",
      status: "in_progress",
    });
    featureId = feature.id;
    await repoAliasService.add(db, SOLO_ACTOR, wsId, projectId, aliasUrl);
  });

  it("matched + dirty=false → trusted", async () => {
    const r = await localEvidenceService.ingest(db, SOLO_ACTOR, wsId, {
      projectId,
      repoRemoteUrl: repoUrl,
      dirtyState: false,
      evidenceType: "test_result",
      title: "pnpm test",
      summary: "28 passed",
    });
    expect(r.trustState).toBe("trusted");
    expect(r.matchStatus).toBe("matched");
  });

  it("matched + dirty=true → working_tree", async () => {
    const r = await localEvidenceService.ingest(db, SOLO_ACTOR, wsId, {
      projectId,
      repoRemoteUrl: repoUrl,
      dirtyState: true,
      evidenceType: "test_result",
      title: "dirty test run",
    });
    expect(r.trustState).toBe("working_tree");
    expect(r.matchStatus).toBe("matched");
  });

  it("alias_matched + clean → trusted", async () => {
    const r = await localEvidenceService.ingest(db, SOLO_ACTOR, wsId, {
      projectId,
      repoRemoteUrl: aliasUrl,
      dirtyState: false,
      evidenceType: "commit",
      title: "commit abc123",
    });
    expect(r.trustState).toBe("trusted");
    expect(r.matchStatus).toBe("alias_matched");
  });

  it("unknown repo → untrusted", async () => {
    const r = await localEvidenceService.ingest(db, SOLO_ACTOR, wsId, {
      projectId,
      repoRemoteUrl: "git@github.com:randos/random.git",
      dirtyState: false,
      evidenceType: "test_result",
      title: "stranger test",
    });
    expect(r.trustState).toBe("untrusted");
    expect(r.matchStatus).toBe("unknown");
  });

  it("repo matches a different project in the workspace → RepoConflictError", async () => {
    await expect(
      localEvidenceService.ingest(db, SOLO_ACTOR, wsId, {
        projectId,
        repoRemoteUrl: "git@github.com:owner/other.git",
        dirtyState: false,
        evidenceType: "test_result",
        title: "wrong project",
      }),
    ).rejects.toThrow(RepoConflictError);
  });

  it("persists evidence row linked to feature when featureId supplied", async () => {
    const r = await localEvidenceService.ingest(db, SOLO_ACTOR, wsId, {
      projectId,
      repoRemoteUrl: repoUrl,
      dirtyState: false,
      evidenceType: "test_result",
      title: "feature-linked test",
      featureId,
    });
    const fetched = await evidenceService.listForFeature(db, wsId, featureId);
    expect(fetched.some((e) => e.id === r.evidence.id)).toBe(true);
  });

  it("git context is embedded in payload_json", async () => {
    const r = await localEvidenceService.ingest(db, SOLO_ACTOR, wsId, {
      projectId,
      repoRemoteUrl: repoUrl,
      gitBranch: "feat/p04",
      baseSha: "abc",
      headSha: "def",
      dirtyState: true,
      evidenceType: "test_result",
      title: "ctx test",
    });
    const fetched = await evidenceService.get(db, wsId, r.evidence.id);
    const payload = JSON.parse(fetched!.payloadJson);
    expect(payload.git_context).toBeDefined();
    expect(payload.git_context.repo_remote_url).toBe(normalizeRepoUrl(repoUrl));
    expect(payload.git_context.git_branch).toBe("feat/p04");
    expect(payload.git_context.dirty_state).toBe(true);
  });
});

describe("P04A agentRunService — git field extensions", () => {
  let db: DbClient;
  let wsId: string;
  let projectId: string;
  let featureId: string;
  const repoUrl = "git@github.com:owner/kavis.git";

  beforeAll(async () => {
    db = createInMemoryDb();
    setDbClient(db);
    const ws = await workspaceService.create(db, SOLO_ACTOR, {
      slug: "p04a-run-ws",
      name: "P04A Run",
    });
    wsId = ws.id;
    const project = await projectService.create(db, SOLO_ACTOR, wsId, {
      slug: "proj",
      name: "P",
      identifier: "PFD",
      repoUrl,
    });
    projectId = project.id;
    const feature = await featureService.create(db, SOLO_ACTOR, wsId, projectId, {
      name: "P04A Run Feat",
      status: "in_progress",
    });
    featureId = feature.id;
  });

  it("start persists repo_remote_url + git_branch + dirty_state", async () => {
    const run = await agentRunService.start(db, SOLO_ACTOR, wsId, {
      projectId,
      featureId,
      agent: "codex",
      runType: "implement",
      repoRemoteUrl: repoUrl,
      gitBranch: "feat/p04",
      baseSha: "abc",
      headSha: "def",
      dirtyState: false,
    });
    expect(run.repoRemoteUrl).toBe(normalizeRepoUrl(repoUrl));
    expect(run.gitBranch).toBe("feat/p04");
    expect(run.dirtyState).toBe("false");

    const fetched = await agentRunService.get(db, wsId, run.id);
    expect(fetched!.repoRemoteUrl).toBe(normalizeRepoUrl(repoUrl));
  });

  it("complete with matching repo + clean → evidence_trust_state=trusted", async () => {
    const run = await agentRunService.start(db, SOLO_ACTOR, wsId, {
      projectId,
      featureId,
      agent: "codex",
      runType: "implement",
      repoRemoteUrl: repoUrl,
      gitBranch: "feat/p04",
      dirtyState: false,
    });
    const completed = await agentRunService.complete(db, SOLO_ACTOR, wsId, run.id, {
      summary: "Implemented P04A",
      repoRemoteUrl: repoUrl,
      dirtyState: false,
    });
    expect(completed.status).toBe("completed");
    expect(completed.evidenceTrustState).toBe("trusted");
  });

  it("complete with matching repo + dirty → evidence_trust_state=working_tree", async () => {
    const run = await agentRunService.start(db, SOLO_ACTOR, wsId, {
      projectId,
      featureId,
      agent: "codex",
      runType: "implement",
    });
    const completed = await agentRunService.complete(db, SOLO_ACTOR, wsId, run.id, {
      summary: "Dirty work",
      repoRemoteUrl: repoUrl,
      dirtyState: true,
    });
    expect(completed.evidenceTrustState).toBe("working_tree");
  });

  it("complete without repo_remote_url keeps P02 default (working_tree)", async () => {
    const run = await agentRunService.start(db, SOLO_ACTOR, wsId, {
      projectId,
      featureId,
      agent: "opencode",
      runType: "investigate",
    });
    const completed = await agentRunService.complete(db, SOLO_ACTOR, wsId, run.id, {
      summary: "Plain P02-style run",
    });
    expect(completed.evidenceTrustState).toBe("working_tree");
  });

  it("complete with unknown repo → working_tree (no trust upgrade)", async () => {
    const run = await agentRunService.start(db, SOLO_ACTOR, wsId, {
      projectId,
      featureId,
      agent: "opencode",
      runType: "investigate",
    });
    const completed = await agentRunService.complete(db, SOLO_ACTOR, wsId, run.id, {
      summary: "Unknown repo",
      repoRemoteUrl: "git@github.com:randos/random.git",
      dirtyState: false,
    });
    expect(completed.evidenceTrustState).toBe("working_tree");
  });
});

describe("P04A normalizeRepoUrl", () => {
  it("collapses ssh + https + .git variants", () => {
    expect(normalizeRepoUrl("git@github.com:owner/kavis.git")).toBe(
      normalizeRepoUrl("https://github.com/owner/kavis"),
    );
    expect(normalizeRepoUrl("https://github.com/owner/kavis/")).toBe(
      normalizeRepoUrl("https://github.com/owner/kavis"),
    );
    expect(normalizeRepoUrl("ssh://git@github.com/owner/kavis.git")).toBe(
      normalizeRepoUrl("git@github.com:owner/kavis"),
    );
  });

  it("lowercases the host", () => {
    expect(normalizeRepoUrl("https://GitHub.com/Owner/Repo")).toBe(
      "https://github.com/Owner/Repo",
    );
  });
});

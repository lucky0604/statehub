/* eslint-disable no-console -- CLI script, console output is the point */
/**
 * Seed script — populates the local DB with a realistic solo-dev scenario.
 *
 * Usage: pnpm db:seed  (runs from repo root)
 *
 * Creates a workspace, a project (with default states + labels), a feature,
 * and work items across different states. Idempotent: reuses existing
 * workspace/project/feature; re-running adds more work items (sequences
 * increment) rather than failing.
 */
import { getDb } from "@statehub/db/node";
import {
  SOLO_ACTOR,
  remoteMcpActor,
  workspaceService,
  projectService,
  stateService,
  featureService,
  workItemService,
  agentRunService,
  todoService,
  reviewService,
  evidenceService,
  actionCardService,
  weeklyReviewService,
  decisionService,
  externalLinkService,
  integrationService,
  githubIssuesImporter,
  aiPmActor,
  type WorkItemType,
  type Priority,
} from "@statehub/domain";

const WS_SLUG = "statehub";
const PROJ_SLUG = "core";
const PROJ_IDENTIFIER = "STH";

async function main() {
  const db = getDb();

  let ws = await workspaceService.getBySlug(db, WS_SLUG);
  if (!ws) {
    ws = await workspaceService.create(db, SOLO_ACTOR, {
      slug: WS_SLUG,
      name: "StateHub Solo",
      description: "Solo developer workspace",
    });
    console.log(`✓ Created workspace ${ws.slug}`);
  } else {
    console.log(`• Reusing workspace ${ws.slug}`);
  }

  let project = await projectService.getBySlug(db, ws.id, PROJ_SLUG);
  if (!project) {
    project = await projectService.create(db, SOLO_ACTOR, ws.id, {
      slug: PROJ_SLUG,
      name: "StateHub Core",
      identifier: PROJ_IDENTIFIER,
      description: "Core StateHub application",
    });
    console.log(`✓ Created project ${project.identifier}`);
  } else {
    console.log(`• Reusing project ${project.identifier}`);
  }

  const features = await featureService.list(db, ws.id, project.id);
  let feature = features[0];
  if (!feature) {
    feature = await featureService.create(db, SOLO_ACTOR, ws.id, project.id, {
      name: "P01A Core CRUD",
      description: "Workspace, project, work item CRUD + list",
    });
    await featureService.changeStatus(db, SOLO_ACTOR, ws.id, feature.id, "planned");
    await featureService.changeStatus(db, SOLO_ACTOR, ws.id, feature.id, "in_progress");
    console.log(`✓ Created feature ${feature.name}`);
  } else {
    console.log(`• Reusing feature ${feature.name}`);
  }

  const allStates = await stateService.list(db, ws.id, project.id);
  const byName = (n: string) => allStates.find((s) => s.name === n)!;
  const states = {
    Backlog: byName("Backlog"),
    Todo: byName("Todo"),
    InProgress: byName("In Progress"),
    Done: byName("Done"),
  };

  const seedItems: { title: string; type: WorkItemType; priority: Priority; stateId: string }[] = [
    { title: "Define schema for 10 core tables", type: "task", priority: "high", stateId: states.Done.id },
    { title: "Implement domain service layer", type: "task", priority: "high", stateId: states.Done.id },
    { title: "Wire API routes with envelope", type: "task", priority: "high", stateId: states.InProgress.id },
    { title: "Build portfolio + project UI", type: "task", priority: "medium", stateId: states.InProgress.id },
    { title: "Write seed script + tests", type: "task", priority: "medium", stateId: states.Todo.id },
    { title: "Playwright smoke test", type: "task", priority: "medium", stateId: states.Todo.id },
    { title: "Kanban board view", type: "enhancement", priority: "low", stateId: states.Backlog.id },
    { title: "Peek panel for work items", type: "enhancement", priority: "low", stateId: states.Backlog.id },
  ];

  let created = 0;
  let reused = 0;
  // Idempotent: skip work items that already exist with the same title in
  // this project. The original seed created duplicates on re-run; that broke
  // e2e tests that match by title (e.g. smoke.spec.ts). Re-running the seed
  // is now safe — sequences stay stable.
  const existingItems = await workItemService.list(db, ws.id, project.id, {});
  const existingTitles = new Set(existingItems.map((wi) => wi.title));
  for (const item of seedItems) {
    if (existingTitles.has(item.title)) {
      reused++;
      continue;
    }
    const wi = await workItemService.create(db, SOLO_ACTOR, ws.id, project.id, {
      title: item.title,
      type: item.type,
      priority: item.priority,
      stateId: item.stateId,
      featureId: feature.id,
    });
    created++;
    console.log(`  ✓ ${wi.projectIdentifier}-${wi.sequenceId} ${wi.title}`);
  }

  console.log(`\n✓ Seeded ${created} work items${reused > 0 ? ` (reused ${reused} existing)` : ""}`);

  // P02C: seed one completed agent run with evidence so the Feature Detail
  // timeline + Done Gate have something to render in e2e + dev.
  const existingRuns = await agentRunService.listForFeature(db, ws.id, feature.id);
  if (existingRuns.length === 0) {
    const run = await agentRunService.start(db, SOLO_ACTOR, ws.id, {
      projectId: project.id,
      featureId: feature.id,
      agent: "opencode",
      runType: "implement",
      model: "glm-5.2",
    });
    await agentRunService.complete(db, SOLO_ACTOR, ws.id, run.id, {
      summary: "Wired workspace/project/work-item CRUD with envelope + list UI",
      filesChanged: ["apps/web/app/api/workspaces/route.ts", "apps/web/src/lib/queries.ts"],
      commandsRun: ["pnpm typecheck", "pnpm test"],
      testResult: "all passing",
    });
    console.log(`✓ Seeded agent run ${run.id} (completed, with evidence)`);
  } else {
    console.log(`• Reusing ${existingRuns.length} agent run(s) on feature`);
  }

  // P02B: seed two todos on the feature so the Feature Detail checklist has
  // something to render in e2e + dev: one open + evidence_required, one done
  // with an evidence_summary. These represent what an agent would create via
  // upsert_todos + update_todo_status.
  const existingTodos = await todoService.listForFeature(db, ws.id, feature.id);
  if (existingTodos.length === 0) {
    const openTodo = await todoService.upsert(db, SOLO_ACTOR, ws.id, {
      projectId: project.id,
      featureId: feature.id,
      title: "P02B seeded open todo",
      type: "implementation",
      priority: "medium",
      evidenceRequired: 1,
    });
    console.log(`✓ Seeded open todo ${openTodo.todo.id} (evidence_required)`);

    const doneTodo = await todoService.upsert(db, SOLO_ACTOR, ws.id, {
      projectId: project.id,
      featureId: feature.id,
      title: "P02B seeded done todo",
      type: "verification",
      priority: "low",
    });
    await todoService.updateStatus(db, SOLO_ACTOR, ws.id, doneTodo.todo.id, {
      status: "in_progress",
    });
    await todoService.updateStatus(db, SOLO_ACTOR, ws.id, doneTodo.todo.id, {
      status: "done",
      evidenceSummary: "seeded e2e evidence summary",
    });
    console.log(`✓ Seeded done todo ${doneTodo.todo.id} (with evidence_summary)`);
  } else {
    console.log(`• Reusing ${existingTodos.length} todo(s) on feature`);
  }

  // P03C: seed one review with one high + one low finding + one linked
  // review_fix work item, so the Review Ledger, Feature Detail findings, Done
  // Gate v1 checklist, and Work Item Peek have data in e2e + dev.
  const existingReviews = await reviewService.listForFeature(db, ws.id, feature.id);
  if (existingReviews.length === 0) {
    const actor = remoteMcpActor("codex", "seed-token-1");
    const submitted = await reviewService.submit(db, actor, ws.id, {
      projectId: project.id,
      featureId: feature.id,
      reviewer: "codex",
      model: "gpt-5",
      verdict: "needs_changes",
      summary: "P03C seeded review — needs changes with one high + one low finding.",
      confidence: "high",
      findings: [
        {
          severity: "high",
          title: "P03C seeded high finding",
          description: "A high-severity issue found by the seeded review.",
          filePath: "apps/web/app/api/workspaces/route.ts",
          lineStart: 12,
          lineEnd: 18,
          suggestion: "Wrap the handler in withEnvelope for a consistent response shape.",
        },
        {
          severity: "low",
          title: "P03C seeded low finding",
          description: "A low-severity polish suggestion.",
        },
      ],
    });
    console.log(`✓ Seeded review ${submitted.review.id} (verdict=needs_changes, 2 findings)`);

    // Create a review_fix work item for the high finding + link it back.
    const followup = await reviewService.createFollowupFixes(db, actor, ws.id, {
      reviewId: submitted.review.id,
    });
    console.log(
      `✓ Created ${followup.createdFixes.length} review_fix work item(s) (skipped ${followup.skippedFindings.length})`,
    );
  } else {
    console.log(`• Reusing ${existingReviews.length} review(s) on feature`);
  }

  // P04C: seed two pieces of local evidence on the feature — one trusted
  // (clean commit, repo matches) and one working_tree (dirty). Gives the
  // EvidencePanel chips and the Done Gate feature_evidence_trusted item
  // something to render in e2e + dev.
  const existingEvidence = await evidenceService.listForFeature(db, ws.id, feature.id);
  const hasTrustedSeed = existingEvidence.some(
    (e) => e.trustState === "trusted" && e.payloadJson.includes("git_context"),
  );
  const hasWorkingTreeSeed = existingEvidence.some(
    (e) => e.trustState === "working_tree" && e.payloadJson.includes("git_context"),
  );

  if (!hasTrustedSeed) {
    await evidenceService.create(db, SOLO_ACTOR, ws.id, {
      projectId: project.id,
      featureId: feature.id,
      evidenceType: "test_result",
      title: "P04C seeded trusted test run",
      summary: "Clean commit, repo matches — trust_state=trusted.",
      payloadJson: JSON.stringify({
        git_context: {
          repo_remote_url: "git@github.com:statehub/core.git",
          git_branch: "main",
          base_sha: "abc123",
          head_sha: "def456",
          dirty_state: false,
          changed_files: [],
          untracked_files: [],
          match_status: "matched",
        },
      }),
      trustState: "trusted",
      stalenessState: "fresh",
    });
    console.log(`✓ Seeded trusted local evidence on feature`);
  } else {
    console.log(`• Reusing trusted local evidence on feature`);
  }

  if (!hasWorkingTreeSeed) {
    await evidenceService.create(db, SOLO_ACTOR, ws.id, {
      projectId: project.id,
      featureId: feature.id,
      evidenceType: "test_result",
      title: "P04C seeded working_tree test run",
      summary: "Dirty working tree — trust_state=working_tree.",
      payloadJson: JSON.stringify({
        git_context: {
          repo_remote_url: "git@github.com:statehub/core.git",
          git_branch: "feat/x",
          base_sha: "abc123",
          head_sha: "def456",
          dirty_state: true,
          changed_files: ["src/x.ts"],
          untracked_files: ["new.txt"],
          match_status: "matched",
        },
      }),
      trustState: "working_tree",
      stalenessState: "fresh",
    });
    console.log(`✓ Seeded working_tree local evidence on feature`);
  } else {
    console.log(`• Reusing working_tree local evidence on feature`);
  }

  // P05C: seed AI PM data — one pending action card, one weekly review,
  // one decision. Gives the AI PM Dock something to render on first load.
  const aiActor = aiPmActor("seed");

  const existingCards = await actionCardService.list(db, ws.id, {
    status: "pending",
    featureId: feature.id,
  });
  if (existingCards.length === 0) {
    await actionCardService.create(db, aiActor, ws.id, "seed-query", {
      type: "create_work_item",
      title: "Add input validation for feature API",
      target: { project_id: project.id, feature_id: feature.id },
      payload: {
        title: "Validate payload before insert",
        type: "task",
        priority: "high",
      },
      reason: "AI PM detected missing validation on the feature's API surface.",
      requires_confirmation: false,
    });
    console.log(`✓ Seeded pending action card on feature`);
  } else {
    console.log(`• Reusing ${existingCards.length} pending action card(s) on feature`);
  }

  // Seed a high-risk card so the UI + e2e can exercise the confirmation modal.
  const existingHighRisk = await actionCardService.list(db, ws.id, {
    status: "pending",
  });
  const hasHighRiskSeed = existingHighRisk.some((c) => c.requiresConfirmation);
  if (!hasHighRiskSeed) {
    await actionCardService.create(db, aiActor, ws.id, "seed-query", {
      type: "change_portfolio_priority",
      title: "Promote project to P0 priority",
      target: { project_id: project.id },
      payload: { project_id: project.id, priority: "P0" },
      reason: "AI PM detected this project is the active focus but sits at P1.",
      risk: "P0 priority reshuffles the portfolio — other projects may be deprioritized.",
      requires_confirmation: true,
    });
    console.log(`✓ Seeded high-risk action card (change_portfolio_priority)`);
  } else {
    console.log(`• Reusing high-risk action card`);
  }

  const existingWeeklyReviews = await weeklyReviewService.list(db, ws.id, {
    projectId: project.id,
  });
  if (existingWeeklyReviews.length === 0) {
    const now = Date.now();
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    await weeklyReviewService.save(db, SOLO_ACTOR, ws.id, {
      projectId: project.id,
      weekStart: now - weekMs,
      weekEnd: now,
      summaryJson: JSON.stringify({
        completed: 3,
        stalled: 1,
        open_risks: ["Cost overrun on Phase 6"],
        next_week_focus: ["Finish P05 UI", "Start P06 import"],
        pause_recommendations: [],
        missing_evidence: [],
      }),
    });
    console.log(`✓ Seeded weekly review for last week`);
  } else {
    console.log(`• Reusing ${existingWeeklyReviews.length} weekly review(s)`);
  }

  const existingDecisions = await decisionService.list(db, ws.id, {
    projectId: project.id,
  });
  if (existingDecisions.length === 0) {
    await decisionService.record(db, SOLO_ACTOR, ws.id, {
      projectId: project.id,
      featureId: feature.id,
      decisionText: "We will ship P05 (writable AI PM) before starting P06.",
      rationale: "P05 unblocks the action-card UX needed by P06 import-preview.",
      source: "user",
    });
    console.log(`✓ Seeded decision on project`);
  } else {
    console.log(`• Reusing ${existingDecisions.length} decision(s)`);
  }

  // P06A: seed one external link on the seeded feature — a fake PR URL — so
  // the integrations page + markdown export have something to render.
  const existingLinks = await externalLinkService.list(db, ws.id, {
    entityType: "feature",
    entityId: feature.id,
  });
  if (existingLinks.length === 0) {
    await externalLinkService.create(db, SOLO_ACTOR, ws.id, {
      projectId: project.id,
      entityType: "feature",
      entityId: feature.id,
      externalSource: "github_pr",
      externalId: "42",
      externalUrl: "https://github.com/statehub/core/pull/42",
    });
    console.log(`✓ Seeded external link (github_pr #42 on feature)`);
  } else {
    console.log(`• Reusing ${existingLinks.length} external link(s) on feature`);
  }

  // P06B: seed a GitHub integration + one prior completed import_job so the
  // integrations settings page + import wizard have history to show.
  const existingIntegrations = await integrationService.list(db, ws.id, {
    provider: "github",
  });
  let integrationId: string | undefined;
  if (existingIntegrations.length === 0) {
    const integration = await integrationService.create(db, SOLO_ACTOR, ws.id, {
      provider: "github",
      name: "statehub/core",
      config: { repo: "statehub/core" },
    });
    integrationId = integration.id;
    console.log(`✓ Seeded GitHub integration (statehub/core)`);
  } else {
    integrationId = existingIntegrations[0]!.id;
    console.log(
      `• Reusing ${existingIntegrations.length} GitHub integration(s)`,
    );
  }

  // Run a one-off import with two sample issues so import_jobs has a row.
  const todoState = (await stateService.list(db, ws.id, project.id)).find(
    (s) => s.name === "Todo",
  );
  if (todoState && integrationId) {
    const existingJobs = await githubIssuesImporter.preview(
      db,
      ws.id,
      integrationId,
      {
        projectId: project.id,
        stateId: todoState.id,
        issues: [
          {
            number: 9001,
            title: "Seed: improve README onboarding section",
            state: "open",
            html_url: "https://github.com/statehub/core/issues/9001",
          },
        ],
      },
    );
    if (existingJobs.toSkip.length === 0) {
      await githubIssuesImporter.run(db, SOLO_ACTOR, ws.id, integrationId, {
        projectId: project.id,
        stateId: todoState.id,
        issues: [
          {
            number: 9001,
            title: "Seed: improve README onboarding section",
            state: "open",
            html_url: "https://github.com/statehub/core/issues/9001",
          },
        ],
      });
      console.log(`✓ Seeded prior import_job (issue #9001 → work item)`);
    } else {
      console.log(`• Reusing prior import_job (issue #9001 already linked)`);
    }
  }

  // P06C: seed placeholder Plane + Linear integrations so the integrations
  // list + import wizard show all three providers on first load. No PAT —
  // the user adds their own. These are config-only (no prior import_job).
  const existingPlane = await integrationService.list(db, ws.id, {
    provider: "plane",
  });
  if (existingPlane.length === 0) {
    await integrationService.create(db, SOLO_ACTOR, ws.id, {
      provider: "plane",
      name: "plane/demo",
      config: { workspace_slug: "demo" },
    });
    console.log(`✓ Seeded Plane integration (plane/demo)`);
  } else {
    console.log(`• Reusing ${existingPlane.length} Plane integration(s)`);
  }

  const existingLinear = await integrationService.list(db, ws.id, {
    provider: "linear",
  });
  if (existingLinear.length === 0) {
    await integrationService.create(db, SOLO_ACTOR, ws.id, {
      provider: "linear",
      name: "linear/demo",
      config: { team_key: "DEMO" },
    });
    console.log(`✓ Seeded Linear integration (linear/demo)`);
  } else {
    console.log(`• Reusing ${existingLinear.length} Linear integration(s)`);
  }
}

main().catch((e) => {
  console.error("✗ Seed failed:", e);
  process.exit(1);
});

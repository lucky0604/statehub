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
  workspaceService,
  projectService,
  stateService,
  featureService,
  workItemService,
  agentRunService,
  todoService,
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
  for (const item of seedItems) {
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

  console.log(`\n✓ Seeded ${created} work items`);

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
}

main().catch((e) => {
  console.error("✗ Seed failed:", e);
  process.exit(1);
});

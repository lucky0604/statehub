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
import { getDb } from "@statehub/db";
import {
  SOLO_ACTOR,
  workspaceService,
  projectService,
  stateService,
  featureService,
  workItemService,
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
}

main().catch((e) => {
  console.error("✗ Seed failed:", e);
  process.exit(1);
});

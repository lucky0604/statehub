import { test, expect, type Page } from "@playwright/test";

/**
 * P02B e2e — agent-created todos surface in the Feature Detail checklist.
 *
 * Source: agent_flow/implementation/v1/iterations/20260716-p02b-agent-write-tools/plan.md §5 #6
 *
 * Assumes `pnpm db:seed` has populated the local DB with a workspace, project,
 * feature, one completed agent run (P02C), and two P02B todos on the feature:
 *   - "P02B seeded open todo" — evidence_required, status backlog
 *   - "P02B seeded done todo" — flipped to done with an evidence_summary
 *
 * The seed calls todoService.upsert + updateStatus — the same code path the
 * MCP tools wrap — so this verifies the loop: agent write → DB → UI query →
 * UI render.
 */

interface Workspace { id: string; slug: string; }
interface Project { id: string; slug: string; identifier: string; }
interface Feature { id: string; name: string; }

async function discoverSeedIds(page: Page): Promise<{ wid: string; pid: string; fid: string }> {
  const wsRes = await page.request.get("/api/workspaces");
  expect(wsRes.ok()).toBe(true);
  const ws: Workspace = (await wsRes.json()).data[0];
  expect(ws).toBeDefined();

  const projRes = await page.request.get(`/api/workspaces/${ws.id}/projects`);
  const proj: Project = (await projRes.json()).data[0];
  expect(proj).toBeDefined();

  const featRes = await page.request.get(`/api/workspaces/${ws.id}/projects/${proj.id}/features`);
  const feat: Feature = (await featRes.json()).data[0];
  expect(feat).toBeDefined();

  return { wid: ws.id, pid: proj.id, fid: feat.id };
}

test("agent-created open todo shows up in the feature detail checklist", async ({ page }) => {
  const { wid, pid, fid } = await discoverSeedIds(page);
  await page.goto(`/workspaces/${wid}/projects/${pid}/features/${fid}`);

  const checklist = page.getByTestId("todo-checklist");
  await expect(checklist).toBeVisible();

  // The open todo (created via upsert_todos with evidence_required=1).
  await expect(checklist.getByText("P02B seeded open todo")).toBeVisible();
  // The evidence_required marker is rendered.
  await expect(checklist.getByText("evidence required", { exact: true })).toBeVisible();
});

test("agent-flipped done todo shows strikethrough + evidence_summary", async ({ page }) => {
  const { wid, pid, fid } = await discoverSeedIds(page);
  await page.goto(`/workspaces/${wid}/projects/${pid}/features/${fid}`);

  const checklist = page.getByTestId("todo-checklist");
  await expect(checklist).toBeVisible();

  // The done todo title is rendered with strikethrough.
  const doneTitle = checklist.getByText("P02B seeded done todo");
  await expect(doneTitle).toBeVisible();
  await expect(doneTitle).toHaveClass(/line-through/);
  // The evidence_summary is rendered.
  await expect(checklist.getByText("seeded e2e evidence summary")).toBeVisible();
});

import { test, expect, type Page } from "@playwright/test";

/**
 * P02C e2e — agent sync UI surfaces.
 *
 * Assumes `pnpm db:seed` has populated the local DB with a workspace, project,
 * feature, and (P02C extension) one completed agent run with evidence.
 *
 * Covers:
 *  - Feature Detail page renders the timeline + Done Gate + evidence panel.
 *  - Agent Run drawer opens on click with files/commands/tests.
 *  - Agent Runs page lists the seeded run grouped by project.
 *  - Tokens settings page renders the issue form.
 *  - TopBar MCP sync indicator is real (not the placeholder text).
 *  - Sidebar "Agent Runs" links to the workspace runs page.
 */

interface Workspace { id: string; slug: string; }
interface Project { id: string; slug: string; }
interface Feature { id: string; name: string; }

async function discoverSeedIds(page: Page): Promise<{ wid: string; pid: string; fid: string }> {
  const wsRes = await page.request.get("/api/workspaces");
  expect(wsRes.ok()).toBe(true);
  const wsBody = await wsRes.json();
  const ws: Workspace = wsBody.data[0];
  expect(ws).toBeDefined();

  const projRes = await page.request.get(`/api/workspaces/${ws.id}/projects`);
  const projBody = await projRes.json();
  const proj: Project = projBody.data[0];
  expect(proj).toBeDefined();

  const featRes = await page.request.get(`/api/workspaces/${ws.id}/projects/${proj.id}/features`);
  const featBody = await featRes.json();
  const feat: Feature = featBody.data[0];
  expect(feat).toBeDefined();

  return { wid: ws.id, pid: proj.id, fid: feat.id };
}

test("feature detail page shows timeline + done gate + evidence", async ({ page }) => {
  const { wid, pid, fid } = await discoverSeedIds(page);
  await page.goto(`/workspaces/${wid}/projects/${pid}/features/${fid}`);

  // Header shows the seeded feature name.
  await expect(page.getByRole("heading", { name: "P01A Core CRUD" })).toBeVisible();

  // Agent Run Timeline section is present and shows the seeded run's summary.
  const timeline = page.getByTestId("agent-run-timeline");
  await expect(timeline).toBeVisible();
  await expect(timeline.getByText(/Wired workspace\/project\/work-item CRUD/)).toBeVisible();

  // Done Gate v0 warning panel is present (the seeded run has test_result, so
  // the gate may show readyForReview — but the section itself is always there).
  await expect(page.getByText("Done Gate", { exact: true }).first()).toBeVisible();

  // Evidence panel shows the seeded evidence row (title contains the run summary).
  await expect(page.getByText("Evidence", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Agent run: Wired workspace/)).toBeVisible();
});

test("clicking a run opens the agent run detail drawer", async ({ page }) => {
  const { wid, pid, fid } = await discoverSeedIds(page);
  await page.goto(`/workspaces/${wid}/projects/${pid}/features/${fid}`);

  // Click the run row (scope to the timeline section).
  const runRow = page.getByTestId("agent-run-timeline").getByText(/Wired workspace\/project\/work-item CRUD/).first();
  await runRow.click();

  // Drawer opens with URL state.
  await expect(page).toHaveURL(/run=/);
  await expect(page.getByRole("dialog", { name: "Agent run detail" })).toBeVisible();

  // Files + commands + test result are visible inside the drawer.
  const dialog = page.getByRole("dialog", { name: "Agent run detail" });
  await expect(dialog.getByText("Files changed")).toBeVisible();
  await expect(dialog.getByText("Commands run")).toBeVisible();
  await expect(dialog.getByText("all passing")).toBeVisible();
  // The seeded file path renders inside the drawer.
  await expect(dialog.getByText("apps/web/app/api/workspaces/route.ts")).toBeVisible();
});

test("agent runs page lists the seeded run grouped by project", async ({ page }) => {
  const { wid } = await discoverSeedIds(page);
  await page.goto(`/workspaces/${wid}/agent-runs`);

  await expect(page.getByRole("heading", { name: "Agent Runs" })).toBeVisible();
  // Project group header shows the identifier.
  await expect(page.getByText("STH", { exact: true })).toBeVisible();
  // The seeded run summary is listed (scope to the timeline on this page).
  const timeline = page.getByTestId("agent-run-timeline");
  await expect(timeline.getByText(/Wired workspace\/project\/work-item CRUD/)).toBeVisible();
});

test("tokens settings page renders the issue form", async ({ page }) => {
  const { wid } = await discoverSeedIds(page);
  await page.goto(`/workspaces/${wid}/settings/tokens`);

  await expect(page.getByRole("heading", { name: "Tokens" })).toBeVisible();
  // Issue form section is present.
  await expect(page.getByText("Issue new token", { exact: true })).toBeVisible();
  // Name input exists.
  await expect(page.getByPlaceholder(/opencode-local/i)).toBeVisible();
});

test("topbar shows the real MCP sync indicator (not placeholder)", async ({ page }) => {
  await page.goto("/");
  // The placeholder text is gone, replaced by the derived indicator.
  await expect(page.getByText("MCP sync placeholder")).toHaveCount(0);
  // The indicator testid is present.
  await expect(page.getByTestId("mcp-sync-indicator")).toBeVisible();
});

test("sidebar Agent Runs links to the workspace runs page", async ({ page }) => {
  await page.goto("/");
  const link = page.getByRole("link", { name: /Agent Runs/ });
  await expect(link).toBeVisible();
  // Clicking navigates to /workspaces/<wid>/agent-runs.
  await link.click();
  await expect(page).toHaveURL(/\/workspaces\/[\w-]+\/agent-runs$/);
});

test("right rail shows recent agent runs section", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("right-rail")).toBeVisible();
  await expect(page.getByText("Recent Agent Runs", { exact: true })).toBeVisible();
  // The seeded run summary appears in the rail.
  await expect(page.getByTestId("right-rail").getByText(/Wired workspace\/project\/work-item CRUD/)).toBeVisible();
});

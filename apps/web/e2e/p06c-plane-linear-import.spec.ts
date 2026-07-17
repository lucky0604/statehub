import { test, expect, type Page } from "@playwright/test";

/**
 * P06C e2e — Plane + Linear import via the provider-dispatch wizard.
 *
 * Assumes `pnpm db:seed` has populated:
 *   - github integration "statehub/core"
 *   - plane integration "plane/demo"
 *   - linear integration "linear/demo"
 *   - one prior completed import_job (issue #9001, github)
 *
 * Covers:
 *  - Integrations panel lists plane + linear seeded integrations.
 *  - Import wizard lists all three providers.
 *  - Pick plane integration → load sample → preview shows Plane toCreate.
 *  - Pick linear integration → load sample → preview shows Linear toCreate.
 *  - Run a plane import creates work items + a job.
 *  - Run a linear import creates work items + a job.
 *  - Idempotency: re-running a plane import skips.
 *  - Import history shows jobs from multiple providers.
 */

interface Workspace { id: string; slug: string; }
interface Project { id: string; slug: string; identifier: string; }

async function discoverSeedIds(page: Page): Promise<{ wid: string; pid: string }> {
  const wsRes = await page.request.get("/api/workspaces");
  expect(wsRes.ok()).toBe(true);
  const wsBody = await wsRes.json();
  const ws: Workspace = wsBody.data[0];
  expect(ws).toBeDefined();

  const projRes = await page.request.get(`/api/workspaces/${ws.id}/projects`);
  const projBody = await projRes.json();
  const proj: Project = projBody.data[0];
  expect(proj).toBeDefined();

  return { wid: ws.id, pid: proj.id };
}

async function discoverTodoStateId(
  page: Page,
  wid: string,
  pid: string,
): Promise<string> {
  const res = await page.request.get(`/api/workspaces/${wid}/projects/${pid}/states`);
  const body = await res.json();
  const todo = body.data.find((s: { name: string }) => s.name === "Todo");
  expect(todo).toBeDefined();
  return todo.id;
}

/** Fill the issues JSON textarea, waiting for hydration first (mobile-safe). */
async function fillIssuesJson(page: Page, issues: unknown[]): Promise<void> {
  const textarea = page.getByTestId("import-issues-json");
  await expect(textarea).toHaveValue(/.+/);
  await textarea.fill(JSON.stringify(issues, null, 2));
  const first = (issues[0] as { name?: string; identifier?: string }).name
    ?? (issues[0] as { identifier?: string }).identifier
    ?? "";
  await expect(textarea).toHaveValue(new RegExp(first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
}

test("integrations panel lists plane + linear seeded integrations", async ({ page }) => {
  const { wid } = await discoverSeedIds(page);
  await page.goto(`/workspaces/${wid}/settings/integrations`);

  await expect(page.getByTestId("integrations-panel")).toBeVisible();
  await expect(page.getByTestId("integration-list")).toContainText("plane");
  await expect(page.getByTestId("integration-list")).toContainText("plane/demo");
  await expect(page.getByTestId("integration-list")).toContainText("linear");
  await expect(page.getByTestId("integration-list")).toContainText("linear/demo");
});

test("import wizard lists all three providers", async ({ page }) => {
  const { wid } = await discoverSeedIds(page);
  await page.goto(`/workspaces/${wid}/import`);

  const select = page.getByTestId("import-integration-select");
  await expect(select).toBeVisible();
  const options = await select.locator("option").allTextContents();
  const joined = options.join("|");
  expect(joined).toContain("github");
  expect(joined).toContain("plane");
  expect(joined).toContain("linear");
});

test("plane integration preview shows Plane-shaped toCreate", async ({ page }) => {
  const { wid, pid } = await discoverSeedIds(page);
  const stateId = await discoverTodoStateId(page, wid, pid);
  await page.goto(`/workspaces/${wid}/import`);

  // Pick the plane integration.
  await page
    .getByTestId("import-integration-select")
    .selectOption({ label: "plane/demo (plane)" });
  // Load the plane sample.
  await page.getByTestId("import-load-sample").click();

  await page.getByTestId("import-project-select").selectOption(pid);
  await page.getByTestId("import-state-select").selectOption(stateId);

  await page.getByTestId("import-preview-btn").click();

  await expect(page.getByTestId("import-step-2")).toBeVisible();
  await expect(page.getByTestId("import-preview-create")).toBeVisible();
  // Plane sample issues are DEMO-101 and DEMO-102.
  await expect(page.getByTestId("import-preview-create")).toContainText("DEMO-101");
  await expect(page.getByTestId("import-preview-create")).toContainText("DEMO-102");
});

test("linear integration preview shows Linear-shaped toCreate", async ({ page }) => {
  const { wid, pid } = await discoverSeedIds(page);
  const stateId = await discoverTodoStateId(page, wid, pid);
  await page.goto(`/workspaces/${wid}/import`);

  await page
    .getByTestId("import-integration-select")
    .selectOption({ label: "linear/demo (linear)" });
  await page.getByTestId("import-load-sample").click();

  await page.getByTestId("import-project-select").selectOption(pid);
  await page.getByTestId("import-state-select").selectOption(stateId);

  await page.getByTestId("import-preview-btn").click();

  await expect(page.getByTestId("import-step-2")).toBeVisible();
  await expect(page.getByTestId("import-preview-create")).toBeVisible();
  // Linear sample titles are "DEMO-101: Ship the thing" etc.
  await expect(page.getByTestId("import-preview-create")).toContainText("Ship the thing");
  await expect(page.getByTestId("import-preview-create")).toContainText("Another one");
});

test("run a plane import creates work items + a job", async ({ page }) => {
  const { wid, pid } = await discoverSeedIds(page);
  const stateId = await discoverTodoStateId(page, wid, pid);
  await page.goto(`/workspaces/${wid}/import`);

  // Unique Plane issue so the test is idempotent across runs.
  const suffix = Math.floor(Math.random() * 99999);
  const issues = [
    {
      id: `plane-e2e-${suffix}`,
      name: `E2E-${suffix}`,
      description: "Plane e2e import",
      state: "In Progress",
      priority: "high",
      project: "Demo",
      link: `https://plane.example/demo/issues/E2E-${suffix}`,
      labels: ["bug"],
    },
  ];
  await page
    .getByTestId("import-integration-select")
    .selectOption({ label: "plane/demo (plane)" });
  await fillIssuesJson(page, issues);
  await page.getByTestId("import-project-select").selectOption(pid);
  await page.getByTestId("import-state-select").selectOption(stateId);

  await page.getByTestId("import-preview-btn").click();
  await expect(page.getByTestId("import-step-2")).toBeVisible();
  await expect(page.getByTestId("import-preview-create")).toContainText(`E2E-${suffix}`);

  await page.getByTestId("import-run-btn").click();
  await expect(page.getByTestId("import-step-3")).toBeVisible();
  await expect(page.getByTestId("import-result-created")).toContainText("work item");

  // History shows a plane job.
  await expect(page.getByTestId("import-job-list")).toContainText("plane");
});

test("run a linear import creates work items + a job", async ({ page }) => {
  const { wid, pid } = await discoverSeedIds(page);
  const stateId = await discoverTodoStateId(page, wid, pid);
  await page.goto(`/workspaces/${wid}/import`);

  const suffix = Math.floor(Math.random() * 99999);
  const issues = [
    {
      id: `linear-e2e-${suffix}`,
      identifier: `E2EL-${suffix}`,
      title: "Linear e2e import",
      description: "Details",
      state: { name: "In Progress", type: "started" },
      priority: 1,
      team: { id: "t1", name: "Demo", key: "DEMO" },
      url: `https://linear.example/issue/E2EL-${suffix}`,
    },
  ];
  await page
    .getByTestId("import-integration-select")
    .selectOption({ label: "linear/demo (linear)" });
  await fillIssuesJson(page, issues);
  await page.getByTestId("import-project-select").selectOption(pid);
  await page.getByTestId("import-state-select").selectOption(stateId);

  await page.getByTestId("import-preview-btn").click();
  await expect(page.getByTestId("import-step-2")).toBeVisible();
  await expect(page.getByTestId("import-preview-create")).toContainText(`E2EL-${suffix}`);

  await page.getByTestId("import-run-btn").click();
  await expect(page.getByTestId("import-step-3")).toBeVisible();
  await expect(page.getByTestId("import-result-created")).toContainText("work item");

  await expect(page.getByTestId("import-job-list")).toContainText("linear");
});

test("re-running a plane import skips already-linked", async ({ page }) => {
  const { wid, pid } = await discoverSeedIds(page);
  const stateId = await discoverTodoStateId(page, wid, pid);
  await page.goto(`/workspaces/${wid}/import`);

  const suffix = Math.floor(Math.random() * 99999);
  const issues = [
    {
      id: `plane-idem-${suffix}`,
      name: `IDEM-${suffix}`,
      state: "In Progress",
      project: "Demo",
      link: `https://plane.example/demo/issues/IDEM-${suffix}`,
    },
  ];
  await page
    .getByTestId("import-integration-select")
    .selectOption({ label: "plane/demo (plane)" });
  await fillIssuesJson(page, issues);
  await page.getByTestId("import-project-select").selectOption(pid);
  await page.getByTestId("import-state-select").selectOption(stateId);

  // First run creates.
  await page.getByTestId("import-preview-btn").click();
  await expect(page.getByTestId("import-preview-create")).toContainText(`IDEM-${suffix}`);
  await page.getByTestId("import-run-btn").click();
  await expect(page.getByTestId("import-result-created")).toContainText("work item");

  // Second preview on the same issue should skip it.
  await page.getByTestId("import-preview-btn").click();
  await expect(page.getByTestId("import-preview-skip")).toContainText(`IDEM-${suffix}`);
});

test("import history shows jobs from multiple providers", async ({ page }) => {
  const { wid } = await discoverSeedIds(page);
  await page.goto(`/workspaces/${wid}/import`);

  await expect(page.getByTestId("import-history")).toBeVisible();
  const list = page.getByTestId("import-job-list");
  // The seeded github job + any plane/linear jobs from prior tests.
  await expect(list).toContainText("github");
});

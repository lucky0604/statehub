import { test, expect, type Page } from "@playwright/test";

/**
 * P07A e2e — GitHub live fetch.
 *
 * Assumes `pnpm db:seed` has populated:
 *   - github integration "statehub/core"
 *   - plane integration "plane/demo"
 *   - linear integration "linear/demo"
 *
 * The playwright config sets STATEHUB_E2E_FETCH_STUB=1 so the fetch
 * route returns canned issues instead of hitting real api.github.com.
 *
 * Covers:
 *  - Wizard shows a "Fetch from provider" button.
 *  - Click fetch on a github integration fills the JSON textarea.
 *  - Fetch note shows issue count.
 *  - Preview works on fetched issues (reuses P06B preview path).
 *  - Run on fetched issues creates work items.
 *  - Fetch on a plane/linear integration returns a clear error
 *    (P07A ships github only).
 *  - Fetch on a missing integration returns 404.
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

async function discoverIntegrationId(
  page: Page,
  wid: string,
  provider: string,
): Promise<string> {
  const res = await page.request.get(`/api/workspaces/${wid}/integrations`);
  expect(res.ok()).toBe(true);
  const body = await res.json();
  const integrations = body.data.integrations as Array<{ id: string; provider: string }>;
  const integration = integrations.find((i) => i.provider === provider);
  expect(integration).toBeDefined();
  return integration!.id;
}

test("wizard shows a Fetch from provider button", async ({ page }) => {
  const { wid } = await discoverSeedIds(page);
  await page.goto(`/workspaces/${wid}/import`);
  await expect(page.getByTestId("import-fetch-btn")).toBeVisible();
});

test("fetch on github integration fills the JSON textarea with real-shaped issues", async ({ page }) => {
  const { wid } = await discoverSeedIds(page);
  await page.goto(`/workspaces/${wid}/import`);

  // Pick the github integration (statehub/core).
  await page
    .getByTestId("import-integration-select")
    .selectOption({ label: "statehub/core (github)" });

  await page.getByTestId("import-fetch-btn").click();

  // The textarea should now contain the stubbed issues (7001 + 7002).
  const textarea = page.getByTestId("import-issues-json");
  await expect(textarea).toHaveValue(/7001/);
  await expect(textarea).toHaveValue(/7002/);
  await expect(textarea).toHaveValue(/E2E stub: live fetch issue 1/);

  // Fetch note should mention the count.
  await expect(page.getByTestId("import-fetch-note")).toContainText(/2 issue/);
});

test("preview works on fetched issues", async ({ page }) => {
  const { wid, pid } = await discoverSeedIds(page);
  const stateId = await discoverTodoStateId(page, wid, pid);
  await page.goto(`/workspaces/${wid}/import`);

  await page
    .getByTestId("import-integration-select")
    .selectOption({ label: "statehub/core (github)" });
  await page.getByTestId("import-fetch-btn").click();

  // Wait for the fetch to actually populate the textarea before moving on —
  // the click returns immediately but setIssuesJson is async.
  await expect(page.getByTestId("import-issues-json")).toHaveValue(/7001/);
  await expect(page.getByTestId("import-fetch-note")).toContainText(/Fetched/);

  await page.getByTestId("import-project-select").selectOption(pid);
  await page.getByTestId("import-state-select").selectOption(stateId);

  await page.getByTestId("import-preview-btn").click();

  await expect(page.getByTestId("import-step-2")).toBeVisible();
  await expect(page.getByTestId("import-preview-create")).toContainText("E2E stub: live fetch issue 1");
  await expect(page.getByTestId("import-preview-create")).toContainText("E2E stub: live fetch issue 2");
});

test("run on fetched issues creates work items", async ({ page }) => {
  test.setTimeout(60000);
  const { wid, pid } = await discoverSeedIds(page);
  const stateId = await discoverTodoStateId(page, wid, pid);

  // Create a fresh integration BEFORE navigating so the wizard picks it up.
  // The stub returns issues 7001 + 7002, which prior tests may have linked,
  // so a fresh integration avoids idempotency skip.
  const createRes = await page.request.post(
    `/api/workspaces/${wid}/integrations`,
    {
      data: {
        provider: "github",
        name: `e2e-fetch-${Date.now()}`,
        config: { repo: "e2e-stub/example" },
      },
    },
  );
  expect(createRes.ok()).toBe(true);
  const createBody = await createRes.json();
  const newIntegrationId = createBody.data.integration.id;
  const newIntegrationName = createBody.data.integration.name;

  await page.goto(`/workspaces/${wid}/import`);
  try {
    await page
      .getByTestId("import-integration-select")
      .selectOption({ label: `${newIntegrationName} (github)` });
    await page.getByTestId("import-fetch-btn").click();

    // Wait for the fetch to populate the textarea before clicking preview.
    await expect(page.getByTestId("import-issues-json")).toHaveValue(/7001/);
    await expect(page.getByTestId("import-fetch-note")).toContainText(/Fetched/);

    await page.getByTestId("import-project-select").selectOption(pid);
    await page.getByTestId("import-state-select").selectOption(stateId);

    await page.getByTestId("import-preview-btn").click();
    await expect(page.getByTestId("import-step-2")).toBeVisible();

    await page.getByTestId("import-run-btn").click();
    await expect(page.getByTestId("import-step-3")).toBeVisible();
    await expect(page.getByTestId("import-result-created")).toContainText("work item");
  } finally {
    // Clean up the integration so the test is idempotent across runs.
    await page.request.delete(
      `/api/workspaces/${wid}/integrations/${newIntegrationId}`,
    );
  }
});

test("fetch on a plane integration returns a clear P07B error", async ({ page }) => {
  const { wid } = await discoverSeedIds(page);
  const iid = await discoverIntegrationId(page, wid, "plane");

  const res = await page.request.post(
    `/api/workspaces/${wid}/integrations/${iid}/fetch`,
    { data: {} },
  );
  expect(res.ok()).toBe(false);
  const body = await res.json();
  // Validation error (400) with a clear "P07B" message.
  expect(body.error_code).toBe("validation_error");
  expect(body.message).toContain("P07B");
});

test("fetch on a missing integration returns 404", async ({ page }) => {
  const { wid } = await discoverSeedIds(page);

  const res = await page.request.post(
    `/api/workspaces/${wid}/integrations/nonexistent-id/fetch`,
    { data: {} },
  );
  expect(res.status()).toBe(404);
  const body = await res.json();
  expect(body.error_code).toBe("not_found");
});

test("fetch API route returns issues in the importer's expected shape", async ({ page }) => {
  const { wid } = await discoverSeedIds(page);
  const iid = await discoverIntegrationId(page, wid, "github");

  const res = await page.request.post(
    `/api/workspaces/${wid}/integrations/${iid}/fetch`,
    { data: { max_issues: 10 } },
  );
  expect(res.ok()).toBe(true);
  const body = await res.json();
  const issues = body.data.issues;
  expect(Array.isArray(issues)).toBe(true);
  expect(issues.length).toBeGreaterThan(0);
  // Each issue should have the GithubIssue shape the importer expects.
  for (const issue of issues) {
    expect(typeof issue.number).toBe("number");
    expect(typeof issue.title).toBe("string");
    expect(typeof issue.html_url).toBe("string");
    expect(issue.state).toMatch(/^(open|closed)$/);
  }
  expect(body.data.provider).toBe("github");
});

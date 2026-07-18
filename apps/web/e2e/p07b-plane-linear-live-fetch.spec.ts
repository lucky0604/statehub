import { test, expect, type Page } from "@playwright/test";

/**
 * P07B e2e — Plane + Linear live fetch.
 *
 * Assumes `pnpm db:seed` has populated:
 *   - github integration "statehub/core"
 *   - plane integration "plane/demo"
 *   - linear integration "linear/demo"
 *
 * The playwright config sets STATEHUB_E2E_FETCH_STUB=1 so the fetch
 * route returns canned issues per provider instead of hitting real
 * Plane/Linear APIs.
 *
 * Covers:
 *  - Fetch on a plane integration fills the JSON textarea with PlaneIssue JSON.
 *  - Preview works on fetched plane issues (reuses P06C preview path).
 *  - Run on fetched plane issues creates work items.
 *  - Same three tests for linear.
 *  - Fetch API route returns PlaneIssue shape for plane integrations.
 *  - Fetch API route returns LinearIssue shape for linear integrations.
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

test("fetch on a plane integration fills the JSON textarea with PlaneIssue JSON", async ({ page }) => {
  const { wid } = await discoverSeedIds(page);
  await page.goto(`/workspaces/${wid}/import`);

  await page
    .getByTestId("import-integration-select")
    .selectOption({ label: "plane/demo (plane)" });

  await page.getByTestId("import-fetch-btn").click();

  const textarea = page.getByTestId("import-issues-json");
  await expect(textarea).toHaveValue(/DEMO-7001/);
  await expect(textarea).toHaveValue(/DEMO-7002/);
  await expect(textarea).toHaveValue(/E2E stub: plane issue 1/);

  await expect(page.getByTestId("import-fetch-note")).toContainText(/2 issue/);
});

test("preview works on fetched plane issues", async ({ page }) => {
  const { wid, pid } = await discoverSeedIds(page);
  const stateId = await discoverTodoStateId(page, wid, pid);
  await page.goto(`/workspaces/${wid}/import`);

  await page
    .getByTestId("import-integration-select")
    .selectOption({ label: "plane/demo (plane)" });
  await page.getByTestId("import-fetch-btn").click();

  await expect(page.getByTestId("import-issues-json")).toHaveValue(/DEMO-7001/);
  await expect(page.getByTestId("import-fetch-note")).toContainText(/Fetched/);

  await page.getByTestId("import-project-select").selectOption(pid);
  await page.getByTestId("import-state-select").selectOption(stateId);

  await page.getByTestId("import-preview-btn").click();

  await expect(page.getByTestId("import-step-2")).toBeVisible();
  await expect(page.getByTestId("import-preview-create")).toContainText("DEMO-7001");
  await expect(page.getByTestId("import-preview-create")).toContainText("DEMO-7002");
});

test("run on fetched plane issues creates work items", async ({ page }) => {
  test.setTimeout(60000);
  const { wid, pid } = await discoverSeedIds(page);
  const stateId = await discoverTodoStateId(page, wid, pid);

  // Create a fresh plane integration so the stub's DEMO-7001/7002
  // haven't been linked by prior runs (idempotency skip).
  const createRes = await page.request.post(
    `/api/workspaces/${wid}/integrations`,
    {
      data: {
        provider: "plane",
        name: `e2e-plane-fetch-${Date.now()}`,
        config: { workspace_slug: "demo" },
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
      .selectOption({ label: `${newIntegrationName} (plane)` });
    await page.getByTestId("import-fetch-btn").click();

    await expect(page.getByTestId("import-issues-json")).toHaveValue(/DEMO-7001/);
    await expect(page.getByTestId("import-fetch-note")).toContainText(/Fetched/);

    await page.getByTestId("import-project-select").selectOption(pid);
    await page.getByTestId("import-state-select").selectOption(stateId);

    await page.getByTestId("import-preview-btn").click();
    await expect(page.getByTestId("import-step-2")).toBeVisible();

    await page.getByTestId("import-run-btn").click();
    await expect(page.getByTestId("import-step-3")).toBeVisible();
    await expect(page.getByTestId("import-result-created")).toContainText("work item");
  } finally {
    await page.request.delete(
      `/api/workspaces/${wid}/integrations/${newIntegrationId}`,
    );
  }
});

test("fetch on a linear integration fills the JSON textarea with LinearIssue JSON", async ({ page }) => {
  const { wid } = await discoverSeedIds(page);
  await page.goto(`/workspaces/${wid}/import`);

  await page
    .getByTestId("import-integration-select")
    .selectOption({ label: "linear/demo (linear)" });

  await page.getByTestId("import-fetch-btn").click();

  const textarea = page.getByTestId("import-issues-json");
  await expect(textarea).toHaveValue(/DEMO-7001/);
  await expect(textarea).toHaveValue(/E2E stub: linear issue 1/);

  await expect(page.getByTestId("import-fetch-note")).toContainText(/2 issue/);
});

test("preview works on fetched linear issues", async ({ page }) => {
  const { wid, pid } = await discoverSeedIds(page);
  const stateId = await discoverTodoStateId(page, wid, pid);
  await page.goto(`/workspaces/${wid}/import`);

  await page
    .getByTestId("import-integration-select")
    .selectOption({ label: "linear/demo (linear)" });
  await page.getByTestId("import-fetch-btn").click();

  await expect(page.getByTestId("import-issues-json")).toHaveValue(/DEMO-7001/);
  await expect(page.getByTestId("import-fetch-note")).toContainText(/Fetched/);

  await page.getByTestId("import-project-select").selectOption(pid);
  await page.getByTestId("import-state-select").selectOption(stateId);

  await page.getByTestId("import-preview-btn").click();

  await expect(page.getByTestId("import-step-2")).toBeVisible();
  await expect(page.getByTestId("import-preview-create")).toContainText("E2E stub: linear issue 1");
  await expect(page.getByTestId("import-preview-create")).toContainText("E2E stub: linear issue 2");
});

test("run on fetched linear issues creates work items", async ({ page }) => {
  test.setTimeout(60000);
  const { wid, pid } = await discoverSeedIds(page);
  const stateId = await discoverTodoStateId(page, wid, pid);

  // Create a fresh linear integration so the stub's DEMO-7001/7002
  // haven't been linked by prior runs.
  const createRes = await page.request.post(
    `/api/workspaces/${wid}/integrations`,
    {
      data: {
        provider: "linear",
        name: `e2e-linear-fetch-${Date.now()}`,
        config: { team_key: "DEMO" },
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
      .selectOption({ label: `${newIntegrationName} (linear)` });
    await page.getByTestId("import-fetch-btn").click();

    await expect(page.getByTestId("import-issues-json")).toHaveValue(/DEMO-7001/);
    await expect(page.getByTestId("import-fetch-note")).toContainText(/Fetched/);

    await page.getByTestId("import-project-select").selectOption(pid);
    await page.getByTestId("import-state-select").selectOption(stateId);

    await page.getByTestId("import-preview-btn").click();
    await expect(page.getByTestId("import-step-2")).toBeVisible();

    await page.getByTestId("import-run-btn").click();
    await expect(page.getByTestId("import-step-3")).toBeVisible();
    await expect(page.getByTestId("import-result-created")).toContainText("work item");
  } finally {
    await page.request.delete(
      `/api/workspaces/${wid}/integrations/${newIntegrationId}`,
    );
  }
});

test("fetch API route returns PlaneIssue shape for plane integration", async ({ page }) => {
  const { wid } = await discoverSeedIds(page);
  const iid = await discoverIntegrationId(page, wid, "plane");

  const res = await page.request.post(
    `/api/workspaces/${wid}/integrations/${iid}/fetch`,
    { data: { max_issues: 10 } },
  );
  expect(res.ok()).toBe(true);
  const body = await res.json();
  const issues = body.data.issues;
  expect(Array.isArray(issues)).toBe(true);
  expect(issues.length).toBeGreaterThan(0);
  for (const issue of issues) {
    expect(typeof issue.id).toBe("string");
    expect(typeof issue.name).toBe("string");
    expect(typeof issue.link).toBe("string");
  }
  expect(body.data.provider).toBe("plane");
});

test("fetch API route returns LinearIssue shape for linear integration", async ({ page }) => {
  const { wid } = await discoverSeedIds(page);
  const iid = await discoverIntegrationId(page, wid, "linear");

  const res = await page.request.post(
    `/api/workspaces/${wid}/integrations/${iid}/fetch`,
    { data: { max_issues: 10 } },
  );
  expect(res.ok()).toBe(true);
  const body = await res.json();
  const issues = body.data.issues;
  expect(Array.isArray(issues)).toBe(true);
  expect(issues.length).toBeGreaterThan(0);
  for (const issue of issues) {
    expect(typeof issue.id).toBe("string");
    expect(typeof issue.identifier).toBe("string");
    expect(typeof issue.title).toBe("string");
    expect(typeof issue.url).toBe("string");
  }
  expect(body.data.provider).toBe("linear");
});

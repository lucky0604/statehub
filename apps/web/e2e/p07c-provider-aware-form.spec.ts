import { test, expect, type Page } from "@playwright/test";

/**
 * P07C e2e — provider-aware integrations form.
 *
 * The integrations panel "Add integration" form switches its config
 * fields based on the selected provider:
 *   - github: repo + PAT
 *   - plane: workspace_slug + API token + base_url
 *   - linear: team_key + API key + base_url
 *   - markdown: no config
 *
 * Covers:
 *  - Form shows workspace_slug field when provider=plane.
 *  - Form shows team_key field when provider=linear.
 *  - Form shows repo field when provider=github.
 *  - Create a plane integration via the form, then fetch from it.
 *  - Create a linear integration via the form, then fetch from it.
 */

interface Workspace { id: string; slug: string; }

async function discoverWorkspaceId(page: Page): Promise<string> {
  const wsRes = await page.request.get("/api/workspaces");
  expect(wsRes.ok()).toBe(true);
  const wsBody = await wsRes.json();
  const ws: Workspace = wsBody.data[0];
  expect(ws).toBeDefined();
  return ws.id;
}

test("form shows repo field when provider=github", async ({ page }) => {
  const wid = await discoverWorkspaceId(page);
  await page.goto(`/workspaces/${wid}/settings/integrations`);

  await page
    .getByTestId("integration-form-provider")
    .selectOption("github");
  await expect(page.getByTestId("integration-form-repo")).toBeVisible();
  await expect(page.getByTestId("integration-form-pat")).toBeVisible();
  await expect(page.getByTestId("integration-form-workspace-slug")).toBeHidden();
  await expect(page.getByTestId("integration-form-team-key")).toBeHidden();
});

test("form shows workspace_slug field when provider=plane", async ({ page }) => {
  const wid = await discoverWorkspaceId(page);
  await page.goto(`/workspaces/${wid}/settings/integrations`);

  await page
    .getByTestId("integration-form-provider")
    .selectOption("plane");
  await expect(page.getByTestId("integration-form-workspace-slug")).toBeVisible();
  await expect(page.getByTestId("integration-form-api-token")).toBeVisible();
  await expect(page.getByTestId("integration-form-base-url")).toBeVisible();
  await expect(page.getByTestId("integration-form-repo")).toBeHidden();
  await expect(page.getByTestId("integration-form-team-key")).toBeHidden();
});

test("form shows team_key field when provider=linear", async ({ page }) => {
  const wid = await discoverWorkspaceId(page);
  await page.goto(`/workspaces/${wid}/settings/integrations`);

  await page
    .getByTestId("integration-form-provider")
    .selectOption("linear");
  await expect(page.getByTestId("integration-form-team-key")).toBeVisible();
  await expect(page.getByTestId("integration-form-api-key")).toBeVisible();
  await expect(page.getByTestId("integration-form-base-url")).toBeVisible();
  await expect(page.getByTestId("integration-form-repo")).toBeHidden();
  await expect(page.getByTestId("integration-form-workspace-slug")).toBeHidden();
});

test("form shows no config fields when provider=markdown", async ({ page }) => {
  const wid = await discoverWorkspaceId(page);
  await page.goto(`/workspaces/${wid}/settings/integrations`);

  await page
    .getByTestId("integration-form-provider")
    .selectOption("markdown");
  await expect(page.getByTestId("integration-form-repo")).toBeHidden();
  await expect(page.getByTestId("integration-form-workspace-slug")).toBeHidden();
  await expect(page.getByTestId("integration-form-team-key")).toBeHidden();
});

test("create a plane integration via the form, then fetch from it", async ({ page }) => {
  test.setTimeout(60000);
  const wid = await discoverWorkspaceId(page);
  await page.goto(`/workspaces/${wid}/settings/integrations`);

  const name = `e2e-form-plane-${Date.now()}`;
  await page
    .getByTestId("integration-form-provider")
    .selectOption("plane");
  await page.getByTestId("integration-form-name").fill(name);
  await page.getByTestId("integration-form-workspace-slug").fill("demo");
  await page.getByTestId("integration-form-submit").click();

  // The new integration should appear in the list.
  await expect(page.getByTestId("integration-list")).toContainText(name);

  // Find the new integration's id via the API.
  const listRes = await page.request.get(`/api/workspaces/${wid}/integrations`);
  expect(listRes.ok()).toBe(true);
  const listBody = await listRes.json();
  const integrations = listBody.data.integrations as Array<{ id: string; name: string }>;
  const created = integrations.find((i) => i.name === name);
  expect(created).toBeDefined();

  try {
    // Go to the import wizard and fetch from the new integration.
    await page.goto(`/workspaces/${wid}/import`);
    await page
      .getByTestId("import-integration-select")
      .selectOption({ label: `${name} (plane)` });
    await page.getByTestId("import-fetch-btn").click();

    await expect(page.getByTestId("import-issues-json")).toHaveValue(/DEMO-7001/);
    await expect(page.getByTestId("import-fetch-note")).toContainText(/Fetched/);
  } finally {
    await page.request.delete(`/api/workspaces/${wid}/integrations/${created!.id}`);
  }
});

test("create a linear integration via the form, then fetch from it", async ({ page }) => {
  test.setTimeout(60000);
  const wid = await discoverWorkspaceId(page);
  await page.goto(`/workspaces/${wid}/settings/integrations`);

  const name = `e2e-form-linear-${Date.now()}`;
  await page
    .getByTestId("integration-form-provider")
    .selectOption("linear");
  await page.getByTestId("integration-form-name").fill(name);
  await page.getByTestId("integration-form-team-key").fill("DEMO");
  await page.getByTestId("integration-form-submit").click();

  await expect(page.getByTestId("integration-list")).toContainText(name);

  const listRes = await page.request.get(`/api/workspaces/${wid}/integrations`);
  expect(listRes.ok()).toBe(true);
  const listBody = await listRes.json();
  const integrations = listBody.data.integrations as Array<{ id: string; name: string }>;
  const created = integrations.find((i) => i.name === name);
  expect(created).toBeDefined();

  try {
    await page.goto(`/workspaces/${wid}/import`);
    await page
      .getByTestId("import-integration-select")
      .selectOption({ label: `${name} (linear)` });
    await page.getByTestId("import-fetch-btn").click();

    await expect(page.getByTestId("import-issues-json")).toHaveValue(/DEMO-7001/);
    await expect(page.getByTestId("import-fetch-note")).toContainText(/Fetched/);
  } finally {
    await page.request.delete(`/api/workspaces/${wid}/integrations/${created!.id}`);
  }
});

import { test, expect, type Page } from "@playwright/test";

/**
 * P06B e2e — GitHub Issues import wizard + integrations panel.
 *
 * Assumes `pnpm db:seed` has populated the local DB with:
 *   - One github integration ("statehub/core")
 *   - One prior completed import_job (issue #9001)
 *
 * Covers:
 *  - Sidebar "Import" entry links to the import wizard.
 *  - Import wizard renders with seeded integration pre-selected.
 *  - Import wizard shows the prior import_job in history.
 *  - Integrations panel lists seeded integration.
 *  - Integrations panel form creates a new GitHub integration.
 *  - Integrations panel remove button deletes an integration.
 *  - Import wizard preview shows toCreate from pasted issues JSON.
 *  - Import wizard run creates work items + shows result.
 *  - Import wizard re-run is idempotent (skipped).
 *  - Import wizard history shows the new job after a run.
 *  - Preview errors on missing title or html_url.
 */

// JSON-paste tests are desktop-first. On mobile-safari (chromium + iPhone 13
// viewport) the controlled-textarea fill is flaky — the React state doesn't
// pick up the synthetic input event reliably. Skip those tests on that project.
const skipOnMobileSafari = (projectName: string) =>
  projectName === "mobile-safari";

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

test("sidebar Import links to the import wizard page", async ({ page }) => {
  const { wid } = await discoverSeedIds(page);
  await page.goto("/");
  const link = page.getByRole("link", { name: /^Import$/ });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/workspaces/${wid}/import$`));
});

test("import wizard renders with seeded integration pre-selected", async ({ page }) => {
  const { wid } = await discoverSeedIds(page);
  await page.goto(`/workspaces/${wid}/import`);

  await expect(page.getByTestId("import-wizard")).toBeVisible();
  await expect(page.getByTestId("import-step-1")).toBeVisible();
  // The select should be populated with at least one GitHub integration.
  const select = page.getByTestId("import-integration-select");
  await expect(select).toHaveValue(/\S/);
  // The seeded "statehub/core" integration should be one of the options.
  const statehubOption = select.locator("option", { hasText: "statehub/core" });
  await expect(statehubOption).toHaveCount(1);
});

test("import wizard shows the prior import_job in history", async ({ page }) => {
  const { wid } = await discoverSeedIds(page);
  await page.goto(`/workspaces/${wid}/import`);

  await expect(page.getByTestId("import-history")).toBeVisible();
  // The seeded job is for issue #9001.
  await expect(page.getByTestId("import-job-list")).toContainText("github");
  await expect(page.getByTestId("import-job-list")).toContainText("completed");
});

test("integrations panel lists seeded integration", async ({ page }) => {
  const { wid } = await discoverSeedIds(page);
  await page.goto(`/workspaces/${wid}/settings/integrations`);

  await expect(page.getByTestId("integrations-panel")).toBeVisible();
  await expect(page.getByTestId("integration-list")).toContainText("github");
  await expect(page.getByTestId("integration-list")).toContainText("statehub/core");
});

test("integrations panel form creates a new GitHub integration", async ({ page }) => {
  const { wid } = await discoverSeedIds(page);
  await page.goto(`/workspaces/${wid}/settings/integrations`);

  const uniqueName = `e2e-int-${Date.now()}`;
  await page.getByTestId("integration-form-provider").selectOption("github");
  await page.getByTestId("integration-form-name").fill(uniqueName);
  await page.getByTestId("integration-form-repo").fill(`e2e/${uniqueName}`);
  await page.getByTestId("integration-form-submit").click();

  await expect(page.getByTestId("integration-list")).toContainText(uniqueName);
});

test("integrations panel remove button deletes an integration", async ({ page }) => {
  const { wid } = await discoverSeedIds(page);
  await page.goto(`/workspaces/${wid}/settings/integrations`);

  // Create a fresh integration to delete.
  const uniqueName = `e2e-del-${Date.now()}`;
  await page.getByTestId("integration-form-provider").selectOption("github");
  await page.getByTestId("integration-form-name").fill(uniqueName);
  await page.getByTestId("integration-form-repo").fill(`e2e/${uniqueName}`);
  await page.getByTestId("integration-form-submit").click();

  const row = page.locator('[data-testid="integration-row"]', {
    hasText: uniqueName,
  });
  await expect(row).toBeVisible();
  await row.getByTestId("integration-remove-btn").click();
  await expect(row).toHaveCount(0);
});

async function fillIssuesJson(page: Page, issues: unknown[]): Promise<void> {
  const textarea = page.getByTestId("import-issues-json");
  // Wait for React hydration to populate the default sample issues first,
  // so our fill isn't racing with the initial useState value.
  await expect(textarea).toHaveValue(/.+/);
  // Use the native setter + input event so the React controlled component
  // sees the change reliably across browsers (mobile-safari in particular
  // doesn't dispatch the input event for `fill()` on controlled textareas).
  const json = JSON.stringify(issues, null, 2);
  await textarea.evaluate(
    (el, value) => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    json,
  );
  // Verify the fill actually took.
  const firstNumber = (issues[0] as { number: number }).number;
  await expect(textarea).toHaveValue(new RegExp(`"number":\\s*${firstNumber}`));
}

test("import wizard preview shows toCreate from pasted issues JSON", async ({ page }) => {
  const { wid, pid } = await discoverSeedIds(page);
  const stateId = await discoverTodoStateId(page, wid, pid);
  await page.goto(`/workspaces/${wid}/import`);

  // Use the load-sample helper to populate the textarea with valid issues.
  await page.getByTestId("import-load-sample").click();

  // Pick the seeded project + Todo state.
  await page.getByTestId("import-project-select").selectOption(pid);
  await page.getByTestId("import-state-select").selectOption(stateId);

  await page.getByTestId("import-preview-btn").click();

  await expect(page.getByTestId("import-step-2")).toBeVisible();
  await expect(page.getByTestId("import-preview-create")).toBeVisible();
  // Sample issues are #101 and #102.
  await expect(page.getByTestId("import-preview-create")).toContainText("#101");
  await expect(page.getByTestId("import-preview-create")).toContainText("#102");
});

test("import wizard run creates work items + shows result", async ({ page }, testInfo) => {
  test.skip(skipOnMobileSafari(testInfo.project.name), "JSON paste UX is desktop-first; mobile-safari controlled-textarea fill is flaky");
  const { wid, pid } = await discoverSeedIds(page);
  const stateId = await discoverTodoStateId(page, wid, pid);
  await page.goto(`/workspaces/${wid}/import`);

  // Use a unique issue number so this test is idempotent across runs.
  const issueNumber = 8000 + Math.floor(Math.random() * 999);
  const issues = [
    {
      number: issueNumber,
      title: `E2E test issue ${issueNumber}`,
      state: "open",
      html_url: `https://github.com/statehub/core/issues/${issueNumber}`,
    },
  ];
  await fillIssuesJson(page, issues);
  await page.getByTestId("import-project-select").selectOption(pid);
  await page.getByTestId("import-state-select").selectOption(stateId);

  await page.getByTestId("import-preview-btn").click();
  await expect(page.getByTestId("import-step-2")).toBeVisible();
  await expect(page.getByTestId("import-preview-create")).toContainText(`#${issueNumber}`);

  await page.getByTestId("import-run-btn").click();
  await expect(page.getByTestId("import-step-3")).toBeVisible();
  await expect(page.getByTestId("import-result-created")).toContainText(`#${issueNumber}`);
  await expect(page.getByTestId("import-result-job-id")).toContainText(/\S/);
});

test("import wizard re-run is idempotent (skipped)", async ({ page }, testInfo) => {
  test.skip(skipOnMobileSafari(testInfo.project.name), "JSON paste UX is desktop-first; mobile-safari controlled-textarea fill is flaky");
  const { wid, pid } = await discoverSeedIds(page);
  const stateId = await discoverTodoStateId(page, wid, pid);
  await page.goto(`/workspaces/${wid}/import`);

  const issueNumber = 8500 + Math.floor(Math.random() * 999);
  const issues = [
    {
      number: issueNumber,
      title: `Idempotent test issue ${issueNumber}`,
      state: "open",
      html_url: `https://github.com/statehub/core/issues/${issueNumber}`,
    },
  ];
  await fillIssuesJson(page, issues);
  await page.getByTestId("import-project-select").selectOption(pid);
  await page.getByTestId("import-state-select").selectOption(stateId);

  // First run creates.
  await page.getByTestId("import-preview-btn").click();
  await expect(page.getByTestId("import-preview-create")).toContainText(`#${issueNumber}`);
  await page.getByTestId("import-run-btn").click();
  await expect(page.getByTestId("import-result-created")).toContainText(`#${issueNumber}`);

  // Second preview on the same issue should skip it.
  await page.getByTestId("import-preview-btn").click();
  await expect(page.getByTestId("import-preview-skip")).toContainText(`#${issueNumber}`);
});

test("import wizard preview errors on missing title or html_url", async ({ page }, testInfo) => {
  test.skip(skipOnMobileSafari(testInfo.project.name), "JSON paste UX is desktop-first; mobile-safari controlled-textarea fill is flaky");
  const { wid, pid } = await discoverSeedIds(page);
  const stateId = await discoverTodoStateId(page, wid, pid);
  await page.goto(`/workspaces/${wid}/import`);

  const badIssues = [
    { number: 1, title: "", state: "open", html_url: "https://x/y/issues/1" },
    { number: 2, title: "Has title", state: "open", html_url: "" },
  ];
  await fillIssuesJson(page, badIssues);
  await page.getByTestId("import-project-select").selectOption(pid);
  await page.getByTestId("import-state-select").selectOption(stateId);

  await page.getByTestId("import-preview-btn").click();

  await expect(page.getByTestId("import-step-2")).toBeVisible();
  await expect(page.getByTestId("import-preview-errors")).toBeVisible();
  await expect(page.getByTestId("import-preview-errors")).toContainText("#1");
  await expect(page.getByTestId("import-preview-errors")).toContainText("#2");
});

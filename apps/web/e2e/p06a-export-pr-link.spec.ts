import { test, expect, type Page } from "@playwright/test";

/**
 * P06A e2e — Markdown export + external links UI.
 *
 * Assumes `pnpm db:seed` has populated the local DB with the P06A seed
 * extension: one external link (github_pr #42) on the seeded feature.
 *
 * Covers:
 *  - Sidebar "Export" + "Integrations" entries link to the right pages.
 *  - /export page renders the seeded markdown with all 8 section headings.
 *  - /export page project picker narrows the export to one project.
 *  - /export page include_reviews=false hides the Review Findings section.
 *  - /export page copy + download buttons work (download triggers a blob).
 *  - Integrations page lists the seeded external link.
 *  - Integrations page form creates a new external link (idempotent on dup).
 *  - Integrations page remove button deletes a link.
 *  - Feature Detail page shows the external links section.
 */

interface Workspace { id: string; slug: string; }
interface Project { id: string; slug: string; identifier: string; }
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

test("sidebar Export links to the export page", async ({ page }) => {
  const { wid } = await discoverSeedIds(page);
  await page.goto("/");
  const link = page.getByRole("link", { name: /^Export$/ });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/workspaces/${wid}/export$`));
});

test("sidebar Integrations links to the integrations settings page", async ({ page }) => {
  const { wid } = await discoverSeedIds(page);
  await page.goto("/");
  const link = page.getByRole("link", { name: /^Integrations$/ });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/workspaces/${wid}/settings/integrations$`));
});

test("export page renders all 8 section headings", async ({ page }) => {
  const { wid } = await discoverSeedIds(page);
  await page.goto(`/workspaces/${wid}/export`);

  await expect(page.getByTestId("markdown-export-pane")).toBeVisible();
  const preview = page.getByTestId("export-markdown-preview");
  await expect(preview).toBeVisible();

  const text = await preview.textContent();
  expect(text).toContain("## Current Focus");
  expect(text).toContain("## Features");
  expect(text).toContain("## Open Work Items");
  expect(text).toContain("## Review Findings");
  expect(text).toContain("## Agent Runs");
  expect(text).toContain("## Evidence");
  expect(text).toContain("## Decisions");
  expect(text).toContain("## Weekly Reviews");
});

test("export page project picker narrows the export", async ({ page }) => {
  const { wid } = await discoverSeedIds(page);
  await page.goto(`/workspaces/${wid}/export`);

  // Select the seeded project (the only one).
  await page.getByTestId("export-project-select").selectOption({ index: 1 });
  await page.getByTestId("export-generate-btn").click();

  // The preview should still have section headings, and the project counter
  // should read "1 project(s)".
  await expect(page.getByText("1 project(s)", { exact: true })).toBeVisible();
  const preview = page.getByTestId("export-markdown-preview");
  await expect(preview).toContainText("## Current Focus");
});

test("export page include_reviews=false hides the Review Findings section", async ({ page }) => {
  const { wid } = await discoverSeedIds(page);
  await page.goto(`/workspaces/${wid}/export`);

  // The initial render includes the Review Findings section. Confirm that
  // before mutating so we know the toggle actually flips state.
  const preview = page.getByTestId("export-markdown-preview");
  await expect(preview).toContainText("## Review Findings");

  // Uncheck "Reviews" and regenerate. Wait for the API response so we
  // know the new markdown is in the preview before asserting.
  await page.getByTestId("export-include-reviews").uncheck();
  const responsePromise = page.waitForResponse(
    (r) => r.url().includes("/export/markdown") && r.url().includes("include_reviews=0"),
  );
  await page.getByTestId("export-generate-btn").click();
  await responsePromise;

  await expect(preview).not.toContainText("## Review Findings");
});

test("export page copy button writes markdown to clipboard", async ({ page, context, browserName }) => {
  test.skip(browserName === "webkit", "webkit doesn't support clipboard-write permission grant");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const { wid } = await discoverSeedIds(page);
  await page.goto(`/workspaces/${wid}/export`);

  await page.getByTestId("export-copy-btn").click();
  // The "copied" indicator flips after a successful clipboard write.
  await expect(page.getByTestId("export-copy-btn")).toContainText("copied");

  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toContain("## Current Focus");
});

test("export page download button triggers a file download", async ({ page }) => {
  const { wid } = await discoverSeedIds(page);
  await page.goto(`/workspaces/${wid}/export`);

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("export-download-btn").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.md$/);
});

test("integrations page lists the seeded external link", async ({ page }) => {
  const { wid } = await discoverSeedIds(page);
  await page.goto(`/workspaces/${wid}/settings/integrations`);

  await expect(page.getByTestId("external-link-manager")).toBeVisible();
  // The seeded link is github_pr #42 on the feature.
  await expect(page.getByTestId("external-link-list")).toContainText("github_pr");
  await expect(page.getByTestId("external-link-list")).toContainText("https://github.com/statehub/core/pull/42");
});

test("integrations page form creates a new external link", async ({ page }) => {
  const { wid, pid, fid } = await discoverSeedIds(page);
  await page.goto(`/workspaces/${wid}/settings/integrations`);

  const uniqueId = `e2e-${Date.now()}`;
  await page.getByTestId("link-form-project").selectOption(pid);
  await page.getByTestId("link-form-entity-type").selectOption("feature");
  await page.getByTestId("link-form-entity-id").fill(fid);
  await page.getByTestId("link-form-source").selectOption("github_pr");
  await page.getByTestId("link-form-external-id").fill(uniqueId);
  await page
    .getByTestId("link-form-url")
    .fill(`https://github.com/statehub/core/pull/${uniqueId}`);
  await page.getByTestId("link-form-submit").click();

  await expect(page.getByTestId("external-link-list")).toContainText(
    `https://github.com/statehub/core/pull/${uniqueId}`,
  );
});

test("integrations page remove button deletes a link", async ({ page }) => {
  const { wid, pid, fid } = await discoverSeedIds(page);
  await page.goto(`/workspaces/${wid}/settings/integrations`);

  // Create a fresh link to delete (so we don't break other tests).
  const uniqueId = `e2e-del-${Date.now()}`;
  await page.getByTestId("link-form-project").selectOption(pid);
  await page.getByTestId("link-form-entity-type").selectOption("feature");
  await page.getByTestId("link-form-entity-id").fill(fid);
  await page.getByTestId("link-form-source").selectOption("github_pr");
  await page.getByTestId("link-form-external-id").fill(uniqueId);
  await page
    .getByTestId("link-form-url")
    .fill(`https://github.com/statehub/core/pull/${uniqueId}`);
  await page.getByTestId("link-form-submit").click();

  // Find the row containing our unique URL and click its remove button.
  const row = page.locator('[data-testid="external-link-row"]', {
    hasText: `https://github.com/statehub/core/pull/${uniqueId}`,
  });
  await expect(row).toBeVisible();
  await row.getByTestId("link-remove-btn").click();
  await expect(row).toHaveCount(0);
});

test("feature detail page shows the external links section", async ({ page }) => {
  const { wid, pid, fid } = await discoverSeedIds(page);
  await page.goto(`/workspaces/${wid}/projects/${pid}/features/${fid}`);

  await expect(page.getByTestId("feature-external-links")).toBeVisible();
  // The seeded link should appear.
  await expect(page.getByTestId("feature-link-list")).toContainText(
    "https://github.com/statehub/core/pull/42",
  );
});

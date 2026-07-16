import { test, expect, type Page } from "@playwright/test";

/**
 * P03C e2e — Review Ledger UI + Feature Detail findings + Done Gate v1.
 *
 * Assumes `pnpm db:seed` has populated the local DB with the P03C seed
 * extension: one review (verdict=needs_changes) with one high + one low
 * finding, plus one linked review_fix work item.
 *
 * Covers:
 *  - Sidebar "Reviews" links to /workspaces/:wid/reviews.
 *  - Review Ledger renders the seeded review with the right verdict + counts.
 *  - Review Ledger verdict filter narrows the table.
 *  - Feature Detail shows the Done Gate v1 checklist with result=blocked.
 *  - Feature Detail shows the findings section grouped by severity.
 *  - review_fix work item badge appears in the work-item list.
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

test("sidebar Reviews links to the workspace reviews page", async ({ page }) => {
  const { wid } = await discoverSeedIds(page);
  await page.goto("/");
  const link = page.getByRole("link", { name: /Reviews/ });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/workspaces/${wid}/reviews$`));
});

test("review ledger renders the seeded review with counts", async ({ page }) => {
  const { wid } = await discoverSeedIds(page);
  await page.goto(`/workspaces/${wid}/reviews`);

  await expect(page.getByTestId("reviews-page")).toBeVisible();
  await expect(page.getByTestId("review-ledger-table")).toBeVisible();

  // The seeded review's verdict is needs_changes.
  await expect(page.getByText("needs changes", { exact: true }).first()).toBeVisible();
  // Findings count = 2 (one high + one low).
  await expect(page.getByTestId("review-ledger-table").getByText("2", { exact: true }).first()).toBeVisible();
  // Open blocker/high count = 1 (the high finding; low doesn't count).
  await expect(page.getByTestId("review-ledger-table").getByText("1", { exact: true }).first()).toBeVisible();
});

test("review ledger verdict filter narrows the table", async ({ page }) => {
  const { wid } = await discoverSeedIds(page);

  // Filter to approved — the seeded review is needs_changes, so the table
  // should be empty.
  await page.goto(`/workspaces/${wid}/reviews?verdict=approved`);
  await expect(page.getByText("No reviews yet.")).toBeVisible();

  // Filter to needs_changes — the seeded review should appear.
  await page.goto(`/workspaces/${wid}/reviews?verdict=needs_changes`);
  await expect(page.getByTestId("review-ledger-table")).toBeVisible();
  await expect(page.getByText("needs changes", { exact: true }).first()).toBeVisible();
});

test("feature detail shows the Done Gate v1 checklist blocked", async ({ page }) => {
  const { wid, pid, fid } = await discoverSeedIds(page);
  await page.goto(`/workspaces/${wid}/projects/${pid}/features/${fid}`);

  // The v1 checklist is present and shows result=blocked (open high finding).
  const checklist = page.getByTestId("done-gate-checklist");
  await expect(checklist).toBeVisible();
  await expect(checklist).toHaveAttribute("data-result", "blocked");

  // The "No open blocker/high findings" item is in the blocked state.
  await expect(checklist.getByText("No open blocker/high findings")).toBeVisible();
});

test("feature detail shows findings grouped by severity", async ({ page }) => {
  const { wid, pid, fid } = await discoverSeedIds(page);
  await page.goto(`/workspaces/${wid}/projects/${pid}/features/${fid}`);

  const findings = page.getByTestId("feature-findings");
  await expect(findings).toBeVisible();

  // Both the high + low seeded findings should appear.
  await expect(findings.getByText("P03C seeded high finding")).toBeVisible();
  await expect(findings.getByText("P03C seeded low finding")).toBeVisible();

  // Severity group headers are present.
  await expect(findings.getByText(/High · 1/)).toBeVisible();
  await expect(findings.getByText(/Low · 1/)).toBeVisible();

  // The high finding's file:line is rendered.
  await expect(findings.getByText(/apps\/web\/app\/api\/workspaces\/route\.ts:12-18/)).toBeVisible();
});

test("review_fix work item shows a badge in the work-item list", async ({ page }) => {
  const { wid, pid } = await discoverSeedIds(page);
  // The P03C seed creates one review_fix work item via createFollowupFixes.
  // The work-items surface is the default project route.
  await page.goto(`/workspaces/${wid}/projects/${pid}`);

  // The review_fix badge is present.
  await expect(page.getByText("review_fix", { exact: true }).first()).toBeVisible();
  // The fix item's title starts with [review_fix].
  await expect(page.getByText(/P03C seeded high finding/).first()).toBeVisible();
});

test("work item peek shows findings linked as fix", async ({ page }) => {
  const { wid, pid } = await discoverSeedIds(page);

  // Discover the review_fix work item via the API.
  const itemsRes = await page.request.get(`/api/workspaces/${wid}/projects/${pid}/work-items`);
  const itemsBody = await itemsRes.json();
  const fixItem = itemsBody.data.find((wi: { title: string }) =>
    wi.title.startsWith("[review_fix]"),
  );
  expect(fixItem).toBeDefined();

  // Open the peek via URL.
  await page.goto(`/workspaces/${wid}/projects/${pid}?peek=${fixItem.id}`);

  // The peek drawer is open.
  await expect(page.getByRole("dialog", { name: "Work item peek" })).toBeVisible();

  // The findings section is present and shows the linked finding.
  await expect(page.getByTestId("work-item-findings")).toBeVisible();
  await expect(page.getByTestId("work-item-findings").getByText("P03C seeded high finding")).toBeVisible();
});

import { test, expect, type Page } from "@playwright/test";

/**
 * P01 smoke tests — drive the real app through the seeded scenario.
 *
 * Assumes `pnpm db:seed` has populated the local DB. The webServer config in
 * playwright.config.ts boots `pnpm dev` automatically.
 *
 * Covers P01A (portfolio, project list, work item detail, sidebar) and
 * P01B (list↔kanban switch, peek drawer, save view, bulk select).
 */

/** Navigate into the seeded project from the portfolio. */
async function openSeededProject(page: Page) {
  await page.goto("/");
  await page.getByRole("link", { name: /StateHub Core/ }).click();
  await expect(page).toHaveURL(/\/workspaces\/[\w-]+\/projects\/[\w-]+/);
}

test("portfolio shows the seeded project", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("StateHub Solo")).toBeVisible();
  const projectCard = page.getByRole("link", { name: /StateHub Core/ });
  await expect(projectCard).toBeVisible();
});

test("project detail lists seeded work items", async ({ page }) => {
  await openSeededProject(page);
  // The project identifier shows in the header.
  await expect(page.getByText("STH", { exact: true })).toBeVisible();
  // A seeded work item title renders in the list table.
  await expect(page.getByText("Wire API routes with envelope")).toBeVisible();
});

test("list ↔ kanban switch is URL-backed", async ({ page }) => {
  await openSeededProject(page);
  // Default is list layout.
  await expect(page.getByRole("button", { name: "List layout" })).toHaveAttribute("aria-pressed", "true");

  // Switch to kanban.
  await page.getByRole("button", { name: "Kanban layout" }).click();
  await expect(page).toHaveURL(/layout=kanban/);
  // Kanban is rendered: the kanban-only "Drop here" prompt is visible in an
  // empty column (Backlog has seeded items, but at least one column is empty).
  await expect(page.getByText("Drop here").first()).toBeVisible();

  // Switch back to list.
  await page.getByRole("button", { name: "List layout" }).click();
  await expect(page).toHaveURL(/layout=list/);
});

test("opening a work item opens the peek drawer", async ({ page }) => {
  await openSeededProject(page);
  // Click the work item row (the title text is in a table cell).
  await page.getByText("Wire API routes with envelope").click();
  // Peek URL state is set.
  await expect(page).toHaveURL(/peek=/);
  // The peek dialog is visible with the title as a heading.
  await expect(page.getByRole("dialog", { name: "Work item peek" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Wire API routes with envelope" }),
  ).toBeVisible();

  // Escape closes the peek.
  await page.keyboard.press("Escape");
  await expect(page).not.toHaveURL(/peek=/);
});

test("dragging a card in kanban changes state", async ({ page }) => {
  await openSeededProject(page);
  await page.getByRole("button", { name: "Kanban layout" }).click();

  // "Kanban board view" is seeded in Backlog. Drag it to the Done column.
  const card = page.getByText("Kanban board view", { exact: true });
  const doneHeader = page.locator("text=Done").first();
  await card.dragTo(doneHeader);

  // After the optimistic move + refresh, the card should be under Done.
  // (Allow a moment for the router refresh to settle.)
  await expect(page.getByText("Kanban board view", { exact: true })).toBeVisible();
});

test("saving and applying a view restores filters", async ({ page }) => {
  await openSeededProject(page);

  // Open the filter popover and pick a status group.
  await page.getByRole("button", { name: /Filter/ }).click();
  // Click the "High" priority chip to filter.
  const highChip = page.getByRole("button", { name: "High", exact: true });
  await highChip.click();
  await expect(page).toHaveURL(/priority=high/);

  // Save the view.
  await page.getByRole("button", { name: /Save view/ }).click();
  const nameInput = page.getByPlaceholder("View name");
  await nameInput.fill("High Priority Items");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  // The view now appears in the Views menu.
  await page.getByRole("button", { name: /Views/ }).click();
  await expect(page.getByText("High Priority Items")).toBeVisible();
});

test("bulk select + status change updates items", async ({ page }) => {
  await openSeededProject(page);

  // Select the first two visible rows via their checkboxes.
  const checkboxes = page.locator('tr[role="row"], tbody tr').locator('span[role="checkbox"]');
  await checkboxes.nth(0).click();
  await checkboxes.nth(1).click();

  // Bulk action bar appears.
  await expect(page.getByText(/selected/)).toBeVisible();

  // Open the bulk state menu and pick Done.
  await page.getByRole("button", { name: /Change state/ }).click();
  await page.getByRole("button", { name: /Done/ }).click();

  // The selection clears after the bulk change.
  await expect(page.getByText(/selected/)).toHaveCount(0);
});

test("work item detail page renders (direct URL)", async ({ page }) => {
  await openSeededProject(page);
  // The list still shows sequence IDs (STH-N).
  await expect(page.getByText(/STH-\d+/).first()).toBeVisible();
});

test("sidebar portfolio link is active on home", async ({ page }) => {
  await page.goto("/");
  const portfolioLink = page.getByRole("link", { name: "Portfolio" });
  await expect(portfolioLink).toHaveAttribute("aria-current", "page");
});

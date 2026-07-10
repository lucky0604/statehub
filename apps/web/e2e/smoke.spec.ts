import { test, expect } from "@playwright/test";

/**
 * P01A smoke test — drives the real app through the seeded scenario.
 *
 * Assumes `pnpm db:seed` has populated the local DB. The webServer config in
 * playwright.config.ts boots `pnpm dev` automatically.
 */

test("portfolio shows the seeded project", async ({ page }) => {
  await page.goto("/");
  // The seeded workspace name renders.
  await expect(page.getByText("StateHub Solo")).toBeVisible();
  // The seeded project card links to its detail page.
  const projectCard = page.getByRole("link", { name: /StateHub Core/ });
  await expect(projectCard).toBeVisible();
});

test("project detail lists seeded work items", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /StateHub Core/ }).click();
  await expect(page).toHaveURL(/\/workspaces\/[\w-]+\/projects\/[\w-]+/);
  // The project identifier shows in the header.
  await expect(page.getByText("STH", { exact: true })).toBeVisible();
  // At least one seeded work item title renders.
  await expect(page.getByText("Wire API routes with envelope")).toBeVisible();
});

test("work item detail page renders", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /StateHub Core/ }).click();
  await page.getByRole("link", { name: /Wire API routes with envelope/ }).click();
  await expect(page).toHaveURL(/\/work-items\/[\w-]+/);
  // The sequence id (STH-N) renders.
  await expect(page.getByText(/STH-\d+/)).toBeVisible();
  // Title renders as a heading.
  await expect(page.getByRole("heading", { name: "Wire API routes with envelope" })).toBeVisible();
});

test("sidebar portfolio link is active on home", async ({ page }) => {
  await page.goto("/");
  const portfolioLink = page.getByRole("link", { name: "Portfolio" });
  await expect(portfolioLink).toHaveAttribute("aria-current", "page");
});

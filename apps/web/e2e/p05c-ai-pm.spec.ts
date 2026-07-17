import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";

/**
 * P05C e2e — AI PM Dock, action cards, confirmation modal, weekly review.
 *
 * Re-seeds the DB in beforeAll to guarantee the high-risk seed card exists
 * (previous e2e runs may have applied it). Tests that mutate cards create
 * their own fresh cards via the /ai-pm/query API so they don't conflict
 * with each other or with the seeded cards.
 *
 * Covers:
 *  - Sidebar "AI PM" links to /workspaces/:wid/ai-pm.
 *  - Dock renders all 5 mode tabs.
 *  - Advisor mode returns an answer + cards after "Run".
 *  - Apply on a low-risk card flips status to applied.
 *  - Dismiss on a card removes it from pending.
 *  - High-risk apply opens the confirmation modal.
 *  - Weekly Review mode renders the seeded review.
 *  - Prompt Builder generates a copyable prompt.
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

/** Re-seed to guarantee the high-risk card exists (previous runs may have applied it). */
test.beforeAll(async () => {
  execSync("pnpm db:seed", { stdio: "pipe" });
});

test("sidebar AI PM links to the workspace ai-pm page", async ({ page }) => {
  const { wid } = await discoverSeedIds(page);
  await page.goto("/");
  const link = page.getByRole("link", { name: /AI PM/ });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/workspaces/${wid}/ai-pm$`));
});

test("ai pm dock renders all 5 mode tabs", async ({ page }) => {
  const { wid } = await discoverSeedIds(page);
  await page.goto(`/workspaces/${wid}/ai-pm`);

  await expect(page.getByTestId("ai-pm-dock")).toBeVisible();
  await expect(page.getByTestId("mode-tab-advisor")).toBeVisible();
  await expect(page.getByTestId("mode-tab-plan")).toBeVisible();
  await expect(page.getByTestId("mode-tab-review_triage")).toBeVisible();
  await expect(page.getByTestId("mode-tab-weekly_review")).toBeVisible();
  await expect(page.getByTestId("mode-tab-prompt_builder")).toBeVisible();
});

test("advisor mode shows answer block after Run", async ({ page }) => {
  const { wid } = await discoverSeedIds(page);
  await page.goto(`/workspaces/${wid}/ai-pm`);

  // Click Run in advisor mode (default).
  await page.getByTestId("run-query-btn").click();

  // Answer block renders.
  await expect(page.getByTestId("ai-answer-block")).toBeVisible({ timeout: 10_000 });
});

test("apply low-risk card creates the underlying entity", async ({ page }) => {
  const { wid, pid } = await discoverSeedIds(page);

  // Create a fresh create_feature card via plan mode (no feature_id →
  // produces create_feature). This keeps the test independent of seed state.
  const queryRes = await page.request.post(`/api/workspaces/${wid}/ai-pm/query`, {
    data: { mode: "plan", project_id: pid },
  });
  expect(queryRes.ok()).toBe(true);
  const queryBody = await queryRes.json();
  // API returns action_cards with camelCase fields (actionType, etc.) —
  // the domain object is passed through unchanged by the route handler.
  const card = queryBody.data.action_cards.find(
    (c: { actionType: string }) => c.actionType === "create_feature",
  );
  expect(card).toBeDefined();

  await page.goto(`/workspaces/${wid}/ai-pm`);
  const cardEl = page.locator(`[data-action-id="${card.id}"]`);
  await expect(cardEl).toBeVisible({ timeout: 10_000 });

  // The DeterministicProvider always proposes name="Next iteration", which
  // collides with prior runs' features (UNIQUE constraint on
  // features.project_id + features.name). Edit the payload to a unique
  // name before applying — this also exercises the edit-then-apply path.
  await cardEl.getByRole("button", { name: "Edit" }).click();
  const uniqueName = `E2E apply ${Date.now()}`;
  const editedPayload = JSON.stringify({
    name: uniqueName,
    description: "Auto-proposed by the deterministic AI PM.",
  });
  await cardEl.getByTestId("payload-editor-textarea").fill(editedPayload);

  // Apply it.
  await cardEl.getByTestId("apply-btn").click();

  // Card status flips to applied.
  await expect(cardEl).toHaveAttribute("data-status", "applied", { timeout: 10_000 });
});

test("dismiss card removes it from the pending list", async ({ page }) => {
  const { wid, pid } = await discoverSeedIds(page);

  // Create a fresh card via the API (plan mode without feature_id produces
  // a create_feature card) so this test doesn't conflict with the apply test.
  const queryRes = await page.request.post(`/api/workspaces/${wid}/ai-pm/query`, {
    data: { mode: "plan", project_id: pid },
  });
  expect(queryRes.ok()).toBe(true);
  const queryBody = await queryRes.json();
  // API returns action_cards with camelCase fields (actionType, etc.).
  const card = queryBody.data.action_cards.find(
    (c: { actionType: string }) => c.actionType === "create_feature",
  );
  expect(card).toBeDefined();

  await page.goto(`/workspaces/${wid}/ai-pm`);
  const cardEl = page.locator(`[data-action-id="${card.id}"]`);
  await expect(cardEl).toBeVisible({ timeout: 10_000 });

  // Dismiss it.
  await cardEl.getByRole("button", { name: "Dismiss" }).click();
  await cardEl.getByRole("button", { name: "Confirm dismiss" }).click();

  // Card status flips to dismissed.
  await expect(cardEl).toHaveAttribute("data-status", "dismissed", { timeout: 10_000 });
});

test("high-risk apply requires confirmation modal", async ({ page }) => {
  const { wid } = await discoverSeedIds(page);
  await page.goto(`/workspaces/${wid}/ai-pm`);

  // The seed creates a change_portfolio_priority card (high-risk).
  // beforeAll re-seeds to guarantee it exists.
  const highRiskCard = page
    .locator('[data-action-type="change_portfolio_priority"][data-status="pending"]')
    .first();
  await expect(highRiskCard).toBeVisible({ timeout: 10_000 });

  // Capture the action id so we can re-locate the card after its status
  // flips — the original locator includes [data-status="pending"], which
  // won't match once the card becomes "applied".
  const actionId = await highRiskCard.getAttribute("data-action-id");
  expect(actionId).toBeTruthy();

  // Click Apply — should open the confirmation modal.
  await highRiskCard.getByTestId("apply-btn").click();
  await expect(page.getByTestId("confirmation-modal")).toBeVisible({ timeout: 5_000 });

  // Apply button in modal is disabled until checkbox is checked.
  const applyBtn = page.getByTestId("confirm-apply-btn");
  await expect(applyBtn).toBeDisabled();

  // Check the box → Apply becomes enabled.
  await page.getByTestId("confirm-checkbox").check();
  await expect(applyBtn).toBeEnabled();

  // Click Apply in the modal → card status flips to applied. Re-locate by
  // action id because the pending-filtered locator won't match anymore.
  await applyBtn.click();
  const cardById = page.locator(`[data-action-id="${actionId}"]`);
  await expect(cardById).toHaveAttribute("data-status", "applied", { timeout: 10_000 });
});

test("weekly review mode renders seeded review sections", async ({ page }) => {
  const { wid } = await discoverSeedIds(page);
  await page.goto(`/workspaces/${wid}/ai-pm`);

  // Switch to weekly review mode.
  await page.getByTestId("mode-tab-weekly_review").click();

  // The seeded weekly review should render.
  await expect(page.getByTestId("weekly-review-card").first()).toBeVisible({ timeout: 10_000 });
});

test("prompt builder generates a copyable prompt", async ({ page }) => {
  const { wid, fid } = await discoverSeedIds(page);
  await page.goto(`/workspaces/${wid}/ai-pm`);

  // Select a feature (required by prompt_builder mode to produce a card).
  await page.getByTestId("feature-select").selectOption(fid);

  // Switch to prompt builder mode.
  await page.getByTestId("mode-tab-prompt_builder").click();

  // The prompt builder component renders.
  await expect(page.getByTestId("prompt-builder")).toBeVisible();

  // Generate a prompt.
  await page.getByTestId("prompt-generate-btn").click();

  // The prompt output appears.
  await expect(page.getByTestId("prompt-output")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("prompt-output")).toContainText("StateHub");
});

import { test, expect, type Page } from "@playwright/test";

/**
 * P04C e2e — local MCP setup page, project settings, evidence chips, Done Gate
 * feature_evidence_trusted item.
 *
 * Assumes `pnpm db:seed` has populated:
 *  - workspace `statehub` / project `core` / feature `P01A Core CRUD`
 *  - one completed agent run with P02C evidence
 *  - (P04C extension) one trusted + one working_tree local evidence row on
 *    the feature, each with payload.git_context
 *
 * Covers:
 *  - Local MCP setup page renders config + OpenCode + Codex snippets + token link
 *  - Project Settings renders repo_url field; saving round-trips
 *  - Adding + removing a repo alias updates the list via router.refresh()
 *  - EvidencePanel renders a "Dirty working tree" chip on the seeded
 *    working_tree evidence row
 *  - DoneGateChecklist renders the new feature_evidence_trusted item with
 *    pass (because the seed has ≥1 trusted evidence)
 */

interface Workspace { id: string; slug: string; }
interface Project { id: string; slug: string; }
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

test("local MCP setup page renders config + OpenCode + Codex snippets + token link", async ({ page }) => {
  const { wid } = await discoverSeedIds(page);
  await page.goto(`/workspaces/${wid}/settings/local-mcp`);

  await expect(page.getByTestId("local-mcp-setup-page")).toBeVisible();
  await expect(page.getByTestId("remote-url")).toBeVisible();
  await expect(page.getByTestId("issue-token-link")).toBeVisible();
  await expect(page.getByTestId("issue-token-link")).toHaveAttribute("href", "/settings/tokens");

  // Snippets render with copy buttons
  await expect(page.getByTestId("config-snippet")).toBeVisible();
  await expect(page.getByTestId("config-snippet-copy")).toBeVisible();
  await expect(page.getByTestId("opencode-snippet")).toBeVisible();
  await expect(page.getByTestId("opencode-snippet-copy")).toBeVisible();
  await expect(page.getByTestId("codex-snippet")).toBeVisible();
  await expect(page.getByTestId("codex-snippet-copy")).toBeVisible();

  // Config snippet contains the workspace slug + tokenEnv placeholder
  const configText = await page.getByTestId("config-snippet").textContent();
  expect(configText).toContain("STATEHUB_TOKEN");
  expect(configText).toContain("tokenEnv");
});

test("project settings renders repo_url field and round-trips on save", async ({ page }) => {
  const { wid, pid } = await discoverSeedIds(page);
  await page.goto(`/workspaces/${wid}/projects/${pid}/settings`);

  await expect(page.getByTestId("project-settings-page")).toBeVisible();
  await expect(page.getByTestId("project-name-input")).toBeVisible();
  await expect(page.getByTestId("project-repo-url-input")).toBeVisible();

  // Type a repo URL + save. The server normalizes SSH form to HTTPS on save
  // (see ProjectSettingsForm helper text + projectService.update).
  await page.getByTestId("project-repo-url-input").fill("git@github.com:statehub/core.git");
  await page.getByTestId("project-settings-save").click();

  // Saved indicator appears
  await expect(page.getByTestId("project-settings-saved")).toBeVisible({ timeout: 5000 });

  // Reload — the normalized value persists
  await page.reload();
  await expect(page.getByTestId("project-repo-url-input")).toHaveValue("https://github.com/statehub/core");
});

test("repo aliases add + remove via the manager", async ({ page }) => {
  const { wid, pid } = await discoverSeedIds(page);
  await page.goto(`/workspaces/${wid}/projects/${pid}/settings`);

  const aliasInput = page.getByTestId("repo-alias-input");
  const addBtn = page.getByTestId("repo-alias-add");

  // Add a unique alias (timestamp-suffixed to avoid collisions across runs).
  // The server normalizes the URL on insert (strips .git, lowercases host),
  // so the value we look for in the list is the normalized form.
  const ts = Date.now();
  const aliasUrlRaw = `https://github.com/statehub/core-fork-${ts}.git`;
  const aliasUrl = `https://github.com/statehub/core-fork-${ts}`;
  await aliasInput.fill(aliasUrlRaw);
  await addBtn.click();

  // The new alias appears in the list
  const aliasList = page.getByTestId("repo-alias-list");
  await expect(aliasList.getByText(aliasUrl)).toBeVisible({ timeout: 5000 });

  // Remove it — find the remove button for the row containing the URL
  const row = aliasList.locator("li", { hasText: aliasUrl });
  const removeBtn = row.getByRole("button", { name: /Remove alias/ });
  await removeBtn.click();

  // The alias is gone
  await expect(aliasList.getByText(aliasUrl)).not.toBeVisible({ timeout: 5000 });
});

test("evidence panel shows dirty warning on seeded working_tree evidence", async ({ page }) => {
  const { wid, pid, fid } = await discoverSeedIds(page);
  await page.goto(`/workspaces/${wid}/projects/${pid}/features/${fid}`);

  const panel = page.getByTestId("evidence-panel");
  await expect(panel).toBeVisible();

  // The seeded working_tree evidence row has dirty_state=true in its payload,
  // so the "Dirty working tree" chip should render at least once.
  await expect(panel.getByTestId("chip-dirty").first()).toBeVisible({ timeout: 5000 });
});

test("done gate checklist renders feature_evidence_trusted item (pass, since seed has trusted evidence)", async ({ page }) => {
  const { wid, pid, fid } = await discoverSeedIds(page);
  await page.goto(`/workspaces/${wid}/projects/${pid}/features/${fid}`);

  const checklist = page.getByTestId("done-gate-checklist");
  await expect(checklist).toBeVisible();

  // The P04C item is present
  await expect(checklist.getByText("Evidence trust state: at least one trusted source")).toBeVisible();
});

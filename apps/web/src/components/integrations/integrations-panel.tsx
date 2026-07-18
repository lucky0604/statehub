"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Loader2, Plus } from "lucide-react";
import type { Integration, IntegrationProvider } from "@statehub/domain";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api-client";

/**
 * Integrations panel — manage workspace-level provider configs.
 *
 * P07C: the "Add integration" form switches its config fields based on
 * the selected provider:
 *   - github: repo (owner/name) + PAT (optional)
 *   - plane: workspace_slug + API token (optional) + base_url (optional)
 *   - linear: team_key + API key (optional) + base_url (optional)
 *   - markdown: no config (export-only)
 *
 * Source: agent_flow/implementation/v1/iterations/20260717-p07c-provider-aware-form/plan.md
 */
interface Props {
  workspaceId: string;
  initialIntegrations: Integration[];
}

const PROVIDERS: Array<{ value: IntegrationProvider; label: string }> = [
  { value: "github", label: "GitHub" },
  { value: "plane", label: "Plane" },
  { value: "linear", label: "Linear" },
  { value: "markdown", label: "Markdown" },
];

function buildConfig(
  provider: IntegrationProvider,
  fields: {
    repo: string;
    pat: string;
    workspaceSlug: string;
    apiToken: string;
    teamKey: string;
    apiKey: string;
    baseUrl: string;
  },
): Record<string, string> {
  if (provider === "github") {
    return { repo: fields.repo, ...(fields.pat ? { pat: fields.pat } : {}) };
  }
  if (provider === "plane") {
    return {
      workspace_slug: fields.workspaceSlug,
      ...(fields.apiToken ? { api_token: fields.apiToken } : {}),
      ...(fields.baseUrl ? { base_url: fields.baseUrl } : {}),
    };
  }
  if (provider === "linear") {
    return {
      team_key: fields.teamKey,
      ...(fields.apiKey ? { api_key: fields.apiKey } : {}),
      ...(fields.baseUrl ? { base_url: fields.baseUrl } : {}),
    };
  }
  // markdown — export-only, no config.
  return {};
}

function isConfigValid(provider: IntegrationProvider, fields: {
  repo: string;
  workspaceSlug: string;
  teamKey: string;
}): boolean {
  if (provider === "github") return fields.repo.trim().length > 0;
  if (provider === "plane") return fields.workspaceSlug.trim().length > 0;
  if (provider === "linear") return fields.teamKey.trim().length > 0;
  // markdown — no config needed, just a name.
  return true;
}

export function IntegrationsPanel({ workspaceId, initialIntegrations }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [integrations, setIntegrations] = useState<Integration[]>(initialIntegrations);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Form state.
  const [provider, setProvider] = useState<IntegrationProvider>("github");
  const [name, setName] = useState("");
  // GitHub fields.
  const [repo, setRepo] = useState("");
  const [pat, setPat] = useState("");
  // Plane fields.
  const [workspaceSlug, setWorkspaceSlug] = useState("");
  const [apiToken, setApiToken] = useState("");
  // Linear fields.
  const [teamKey, setTeamKey] = useState("");
  const [apiKey, setApiKey] = useState("");
  // Shared optional override (Plane/Linear only).
  const [baseUrl, setBaseUrl] = useState("");

  const base = `/api/workspaces/${workspaceId}/integrations`;

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return;
    const fields = { repo, pat, workspaceSlug, apiToken, teamKey, apiKey, baseUrl };
    if (!isConfigValid(provider, fields)) return;
    setCreating(true);
    try {
      const result = await api.post<{ integration_id: string; integration: Integration }>(
        base,
        { provider, name, config: buildConfig(provider, fields) },
      );
      setIntegrations((prev) =>
        prev.some((i) => i.id === result.integration.id)
          ? prev
          : [result.integration, ...prev],
      );
      // Reset all fields — provider stays so the user can add another
      // of the same type quickly.
      setName("");
      setRepo("");
      setPat("");
      setWorkspaceSlug("");
      setApiToken("");
      setTeamKey("");
      setApiKey("");
      setBaseUrl("");
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create integration");
    } finally {
      setCreating(false);
    }
  }

  async function remove(id: string) {
    if (removingId) return;
    setRemovingId(id);
    setError(null);
    try {
      await api.del(`${base}/${id}`);
      setIntegrations((prev) => prev.filter((i) => i.id !== id));
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to remove integration");
    } finally {
      setRemovingId(null);
    }
  }

  const configValid = isConfigValid(provider, { repo, workspaceSlug, teamKey });

  return (
    <div className="space-y-4" data-testid="integrations-panel">
      {error ? (
        <div className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-[12px] text-danger">
          {error}
        </div>
      ) : null}

      <form
        onSubmit={(e) => void create(e)}
        className="rounded-md border border-border-subtle bg-surface-1 p-4"
        data-testid="integration-form"
      >
        <div className="text-[13px] font-semibold text-txt-primary">Add integration</div>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <label className="flex flex-col gap-1 text-[11px] text-txt-secondary">
            Provider
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as IntegrationProvider)}
              className="rounded-md border border-border-subtle bg-surface px-2 py-1.5 text-[12px] text-txt-primary"
              data-testid="integration-form-provider"
            >
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-[11px] text-txt-secondary">
            Name
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="statehub/core"
              className="rounded-md border border-border-subtle bg-surface px-2 py-1.5 text-[12px] text-txt-primary"
              data-testid="integration-form-name"
            />
          </label>

          {provider === "github" ? (
            <>
              <label className="flex flex-col gap-1 text-[11px] text-txt-secondary">
                Repo (owner/name)
                <input
                  type="text"
                  value={repo}
                  onChange={(e) => setRepo(e.target.value)}
                  placeholder="statehub/core"
                  className="rounded-md border border-border-subtle bg-surface px-2 py-1.5 text-[12px] text-txt-primary"
                  data-testid="integration-form-repo"
                />
              </label>

              <label className="flex flex-col gap-1 text-[11px] text-txt-secondary">
                PAT (optional)
                <input
                  type="password"
                  value={pat}
                  onChange={(e) => setPat(e.target.value)}
                  placeholder="ghp_..."
                  autoComplete="off"
                  className="rounded-md border border-border-subtle bg-surface px-2 py-1.5 text-[12px] text-txt-primary"
                  data-testid="integration-form-pat"
                />
              </label>
            </>
          ) : null}

          {provider === "plane" ? (
            <>
              <label className="flex flex-col gap-1 text-[11px] text-txt-secondary">
                Workspace slug
                <input
                  type="text"
                  value={workspaceSlug}
                  onChange={(e) => setWorkspaceSlug(e.target.value)}
                  placeholder="demo"
                  className="rounded-md border border-border-subtle bg-surface px-2 py-1.5 text-[12px] text-txt-primary"
                  data-testid="integration-form-workspace-slug"
                />
              </label>

              <label className="flex flex-col gap-1 text-[11px] text-txt-secondary">
                API token (optional)
                <input
                  type="password"
                  value={apiToken}
                  onChange={(e) => setApiToken(e.target.value)}
                  placeholder="pla_..."
                  autoComplete="off"
                  className="rounded-md border border-border-subtle bg-surface px-2 py-1.5 text-[12px] text-txt-primary"
                  data-testid="integration-form-api-token"
                />
              </label>

              <label className="flex flex-col gap-1 text-[11px] text-txt-secondary">
                Base URL (optional, self-hosted)
                <input
                  type="text"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.plane.so"
                  className="rounded-md border border-border-subtle bg-surface px-2 py-1.5 text-[12px] text-txt-primary"
                  data-testid="integration-form-base-url"
                />
              </label>
            </>
          ) : null}

          {provider === "linear" ? (
            <>
              <label className="flex flex-col gap-1 text-[11px] text-txt-secondary">
                Team key
                <input
                  type="text"
                  value={teamKey}
                  onChange={(e) => setTeamKey(e.target.value)}
                  placeholder="DEMO"
                  className="rounded-md border border-border-subtle bg-surface px-2 py-1.5 text-[12px] text-txt-primary"
                  data-testid="integration-form-team-key"
                />
              </label>

              <label className="flex flex-col gap-1 text-[11px] text-txt-secondary">
                API key (optional)
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="lin_api_..."
                  autoComplete="off"
                  className="rounded-md border border-border-subtle bg-surface px-2 py-1.5 text-[12px] text-txt-primary"
                  data-testid="integration-form-api-key"
                />
              </label>

              <label className="flex flex-col gap-1 text-[11px] text-txt-secondary">
                Base URL (optional)
                <input
                  type="text"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.linear.app"
                  className="rounded-md border border-border-subtle bg-surface px-2 py-1.5 text-[12px] text-txt-primary"
                  data-testid="integration-form-base-url"
                />
              </label>
            </>
          ) : null}

          {provider === "markdown" ? (
            <div className="col-span-2 text-[11px] text-txt-tertiary md:col-span-3">
              Markdown integrations are export-only — no config needed.
            </div>
          ) : null}
        </div>

        <div className="mt-3 flex justify-end">
          <Button
            type="submit"
            size="sm"
            disabled={creating || !name.trim() || !configValid}
            data-testid="integration-form-submit"
          >
            {creating ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="mr-1 h-3.5 w-3.5" />
            )}
            Add
          </Button>
        </div>
      </form>

      <div className="rounded-md border border-border-subtle bg-surface-1 p-4">
        <div className="text-[13px] font-semibold text-txt-primary">
          Configured integrations ({integrations.length})
        </div>
        <ul className="mt-3 space-y-2" data-testid="integration-list">
          {integrations.length === 0 ? (
            <li className="text-[12px] text-txt-tertiary">No integrations yet.</li>
          ) : (
            integrations.map((i) => (
              <li
                key={i.id}
                className="flex flex-wrap items-center gap-2 rounded-md border border-border-subtle bg-surface px-3 py-2 text-[12px]"
                data-testid="integration-row"
                data-integration-id={i.id}
              >
                <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-txt-secondary">
                  {i.provider}
                </span>
                <span className="text-txt-primary">{i.name}</span>
                <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-txt-tertiary">
                  {i.status}
                </span>
                <button
                  type="button"
                  onClick={() => void remove(i.id)}
                  disabled={removingId === i.id}
                  className="ml-auto text-txt-tertiary hover:text-danger"
                  data-testid="integration-remove-btn"
                  aria-label="Remove integration"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}

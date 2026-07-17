"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Loader2, Plus } from "lucide-react";
import type { Integration, IntegrationProvider } from "@statehub/domain";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api-client";

/**
 * Integrations panel — manage workspace-level provider configs (GitHub
 * repos for P06B). Each integration stores the repo + PAT and is the
 * source-of-truth for an import source.
 *
 * Source: agent_flow/implementation/v1/phases/phase-06-import-integration.md §4.1
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
  const [repo, setRepo] = useState("");
  const [pat, setPat] = useState("");

  const base = `/api/workspaces/${workspaceId}/integrations`;

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !repo.trim()) return;
    setCreating(true);
    try {
      const result = await api.post<{ integration_id: string; integration: Integration }>(
        base,
        {
          provider,
          name,
          config: { repo, ...(pat ? { pat } : {}) },
        },
      );
      setIntegrations((prev) =>
        prev.some((i) => i.id === result.integration.id)
          ? prev
          : [result.integration, ...prev],
      );
      setName("");
      setRepo("");
      setPat("");
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
        </div>

        <div className="mt-3 flex justify-end">
          <Button
            type="submit"
            size="sm"
            disabled={creating || !name.trim() || !repo.trim()}
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

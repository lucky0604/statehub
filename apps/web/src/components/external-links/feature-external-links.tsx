"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, ExternalLink as LinkIcon, Plus } from "lucide-react";
import type { ExternalLink } from "@statehub/domain";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api-client";

/**
 * Feature detail external-links section — list + add + remove links on a
 * single feature. Compact version of the Integrations page form, scoped to
 * this feature.
 *
 * Source: agent_flow/implementation/v1/phases/phase-06-import-integration.md §5
 */
interface Props {
  workspaceId: string;
  projectId: string;
  featureId: string;
  initialLinks: ExternalLink[];
}

const SOURCES = [
  { value: "github_pr", label: "GitHub PR" },
  { value: "github_issue", label: "GitHub Issue" },
  { value: "plane", label: "Plane" },
  { value: "linear", label: "Linear" },
  { value: "manual", label: "Manual" },
] as const;

export function FeatureExternalLinks({
  workspaceId,
  projectId,
  featureId,
  initialLinks,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [links, setLinks] = useState<ExternalLink[]>(initialLinks);
  const [showForm, setShowForm] = useState(false);
  const [externalSource, setExternalSource] = useState<string>("github_pr");
  const [externalId, setExternalId] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const base = `/api/workspaces/${workspaceId}/external-links`;

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (!externalId.trim() || !externalUrl.trim()) return;
    setBusy(true);
    try {
      const result = await api.post<{ link_id: string; link: ExternalLink }>(base, {
        project_id: projectId,
        entity_type: "feature",
        entity_id: featureId,
        external_source: externalSource,
        external_id: externalId,
        external_url: externalUrl,
      });
      setLinks((prev) =>
        prev.some((l) => l.id === result.link.id) ? prev : [result.link, ...prev],
      );
      setExternalId("");
      setExternalUrl("");
      setShowForm(false);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create link");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (removingId) return;
    setRemovingId(id);
    setError(null);
    try {
      await api.del(`${base}/${id}`);
      setLinks((prev) => prev.filter((l) => l.id !== id));
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to remove link");
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <section
      className="rounded-md border border-border-subtle bg-surface-1 p-4"
      data-testid="feature-external-links"
    >
      <div className="flex items-center justify-between">
        <div className="text-[13px] font-semibold text-txt-primary">
          External links ({links.length})
        </div>
        <Button
          type="button"
          size="sm"
          variant="neutral"
          onClick={() => setShowForm((v) => !v)}
          data-testid="feature-link-toggle-form"
        >
          <Plus className="h-3.5 w-3.5" />
          {showForm ? "cancel" : "add"}
        </Button>
      </div>

      {error ? (
        <div className="mt-2 rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-[12px] text-danger">
          {error}
        </div>
      ) : null}

      {showForm ? (
        <form
          onSubmit={(e) => void create(e)}
          className="mt-3 space-y-2 rounded-md border border-border-subtle bg-surface p-3"
          data-testid="feature-link-form"
        >
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <label className="flex flex-col gap-1 text-[11px] text-txt-secondary">
              Source
              <select
                value={externalSource}
                onChange={(e) => setExternalSource(e.target.value)}
                className="rounded-md border border-border-subtle bg-surface px-2 py-1.5 text-[12px] text-txt-primary"
                data-testid="feature-link-source"
              >
                {SOURCES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-txt-secondary">
              External ID
              <input
                type="text"
                value={externalId}
                onChange={(e) => setExternalId(e.target.value)}
                placeholder="42"
                className="rounded-md border border-border-subtle bg-surface px-2 py-1.5 text-[12px] text-txt-primary"
                data-testid="feature-link-external-id"
              />
            </label>
            <label className="col-span-2 flex flex-col gap-1 text-[11px] text-txt-secondary md:col-span-3">
              URL
              <input
                type="url"
                value={externalUrl}
                onChange={(e) => setExternalUrl(e.target.value)}
                placeholder="https://github.com/statehub/core/pull/42"
                className="rounded-md border border-border-subtle bg-surface px-2 py-1.5 text-[12px] text-txt-primary"
                data-testid="feature-link-url"
              />
            </label>
          </div>
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={busy} data-testid="feature-link-submit">
              {busy ? "Adding…" : "Add link"}
            </Button>
          </div>
        </form>
      ) : null}

      <ul className="mt-3 space-y-1.5" data-testid="feature-link-list">
        {links.length === 0 ? (
          <li className="text-[12px] text-txt-tertiary">No external links yet.</li>
        ) : (
          links.map((l) => (
            <li
              key={l.id}
              className="flex flex-wrap items-center gap-2 rounded-md border border-border-subtle bg-surface px-3 py-2 text-[12px]"
              data-testid="feature-link-row"
              data-link-id={l.id}
            >
              <LinkIcon className="h-3.5 w-3.5 text-txt-tertiary" />
              <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-txt-secondary">
                {l.externalSource}
              </span>
              <span className="text-txt-secondary">#{l.externalId}</span>
              <a
                href={l.externalUrl}
                target="_blank"
                rel="noreferrer"
                className="font-mono-app text-[11px] text-accent-primary hover:underline"
              >
                {l.externalUrl}
              </a>
              <button
                type="button"
                onClick={() => void remove(l.id)}
                disabled={removingId === l.id}
                className="ml-auto text-txt-tertiary hover:text-danger"
                data-testid="feature-link-remove"
                aria-label="Remove link"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))
        )}
      </ul>
    </section>
  );
}

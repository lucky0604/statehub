"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, ExternalLink as LinkIcon } from "lucide-react";
import type { ExternalLink } from "@statehub/domain";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api-client";

/**
 * External link manager — list + create + remove external links.
 *
 * The link form takes an entity selector (project + entity_type + entity_id
 * for now — a project picker narrows the entity options), the external source
 * (github_pr / github_issue / plane / linear / manual), external_id, and URL.
 *
 * For P06A the entity_id is a free-text input — in P06B/P06C the import
 * mappers will fill it programmatically.
 */
interface Props {
  workspaceId: string;
  projects: Array<{ id: string; name: string; identifier: string }>;
  initialLinks: ExternalLink[];
}

const SOURCES = [
  { value: "github_pr", label: "GitHub PR" },
  { value: "github_issue", label: "GitHub Issue" },
  { value: "plane", label: "Plane" },
  { value: "linear", label: "Linear" },
  { value: "manual", label: "Manual" },
] as const;

const ENTITY_TYPES = [
  { value: "feature", label: "Feature" },
  { value: "work_item", label: "Work item" },
  { value: "evidence", label: "Evidence" },
  { value: "decision", label: "Decision" },
  { value: "review_finding", label: "Review finding" },
  { value: "project", label: "Project" },
] as const;

export function ExternalLinkManager({ workspaceId, projects, initialLinks }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [links, setLinks] = useState<ExternalLink[]>(initialLinks);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  // Form state.
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [entityType, setEntityType] = useState<string>("feature");
  const [entityId, setEntityId] = useState("");
  const [externalSource, setExternalSource] = useState<string>("github_pr");
  const [externalId, setExternalId] = useState("");
  const [externalUrl, setExternalUrl] = useState("");

  const base = `/api/workspaces/${workspaceId}/external-links`;

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!entityId.trim() || !externalId.trim() || !externalUrl.trim()) return;
    try {
      const result = await api.post<{ link_id: string; link: ExternalLink }>(base, {
        project_id: projectId || null,
        entity_type: entityType,
        entity_id: entityId,
        external_source: externalSource,
        external_id: externalId,
        external_url: externalUrl,
      });
      setLinks((prev) =>
        prev.some((l) => l.id === result.link.id) ? prev : [result.link, ...prev],
      );
      setEntityId("");
      setExternalId("");
      setExternalUrl("");
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create link");
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
    <div className="space-y-4" data-testid="external-link-manager">
      {error ? (
        <div className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-[12px] text-danger">
          {error}
        </div>
      ) : null}

      <form
        onSubmit={(e) => void create(e)}
        className="rounded-md border border-border-subtle bg-surface-1 p-4"
        data-testid="external-link-form"
      >
        <div className="text-[13px] font-semibold text-txt-primary">Add external link</div>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
          <label className="flex flex-col gap-1 text-[11px] text-txt-secondary">
            Project
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="rounded-md border border-border-subtle bg-surface px-2 py-1.5 text-[12px] text-txt-primary"
              data-testid="link-form-project"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.identifier})
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-[11px] text-txt-secondary">
            Entity type
            <select
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
              className="rounded-md border border-border-subtle bg-surface px-2 py-1.5 text-[12px] text-txt-primary"
              data-testid="link-form-entity-type"
            >
              {ENTITY_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-[11px] text-txt-secondary">
            Entity ID
            <input
              type="text"
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
              placeholder="feature/work-item id"
              className="rounded-md border border-border-subtle bg-surface px-2 py-1.5 text-[12px] text-txt-primary"
              data-testid="link-form-entity-id"
            />
          </label>

          <label className="flex flex-col gap-1 text-[11px] text-txt-secondary">
            Source
            <select
              value={externalSource}
              onChange={(e) => setExternalSource(e.target.value)}
              className="rounded-md border border-border-subtle bg-surface px-2 py-1.5 text-[12px] text-txt-primary"
              data-testid="link-form-source"
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
              data-testid="link-form-external-id"
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
              data-testid="link-form-url"
            />
          </label>
        </div>

        <div className="mt-3 flex justify-end">
          <Button type="submit" size="sm" data-testid="link-form-submit">
            Add link
          </Button>
        </div>
      </form>

      <div className="rounded-md border border-border-subtle bg-surface-1 p-4">
        <div className="text-[13px] font-semibold text-txt-primary">
          Existing links ({links.length})
        </div>
        <ul className="mt-3 space-y-2" data-testid="external-link-list">
          {links.length === 0 ? (
            <li className="text-[12px] text-txt-tertiary">No external links yet.</li>
          ) : (
            links.map((l) => (
              <li
                key={l.id}
                className="flex flex-wrap items-center gap-2 rounded-md border border-border-subtle bg-surface px-3 py-2 text-[12px]"
                data-testid="external-link-row"
                data-link-id={l.id}
              >
                <LinkIcon className="h-3.5 w-3.5 text-txt-tertiary" />
                <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-txt-secondary">
                  {l.externalSource}
                </span>
                <span className="text-txt-secondary">
                  {l.entityType}/{l.entityId.slice(0, 8)}
                </span>
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
                  data-testid="link-remove-btn"
                  aria-label="Remove link"
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

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "../ui/input";
import { Button } from "../ui/button";

/**
 * ProjectSettingsForm — editable project fields including repo_url.
 *
 * Source: agent_flow/implementation/v1/iterations/20260716-p04c-ui-docs-e2e/plan.md §2.1
 *
 * The repo_url is normalized on the server (normalizeRepoUrl) when the project
 * is updated. The form just sends the raw value.
 */
interface Props {
  workspaceId: string;
  projectId: string;
  initialName: string;
  initialIdentifier: string;
  initialDescription: string | null;
  initialRepoUrl: string | null;
}

export function ProjectSettingsForm({
  workspaceId,
  projectId,
  initialName,
  initialIdentifier,
  initialDescription,
  initialRepoUrl,
}: Props) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription ?? "");
  const [repoUrl, setRepoUrl] = useState(initialRepoUrl ?? "");
  const [saving, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  function save() {
    setError(null);
    startSave(async () => {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/projects/${projectId}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name,
            description: description || null,
            repoUrl: repoUrl || null,
          }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.message ?? `save failed (status ${res.status})`);
        return;
      }
      setSavedAt(Date.now());
      router.refresh();
    });
  }

  return (
    <div className="rounded-md border border-border-subtle bg-surface-1 p-4">
      <div className="text-[11px] font-medium uppercase tracking-wide text-txt-tertiary">
        Project
      </div>
      <div className="mt-3 space-y-3">
        <label className="block">
          <span className="text-[12px] font-medium text-txt-secondary">Name</span>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-testid="project-name-input"
            className="mt-1"
          />
        </label>
        <label className="block">
          <span className="text-[12px] font-medium text-txt-secondary">Identifier</span>
          <Input
            value={initialIdentifier}
            readOnly
            disabled
            className="mt-1 font-mono-app"
            data-testid="project-identifier-input"
          />
        </label>
        <label className="block">
          <span className="text-[12px] font-medium text-txt-secondary">Description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="mt-1 flex min-h-[60px] w-full rounded-md border border-border-subtle bg-surface-1 px-3 py-1 text-[13px] text-txt-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
            data-testid="project-description-input"
          />
        </label>
        <label className="block">
          <span className="text-[12px] font-medium text-txt-secondary">Repo URL</span>
          <Input
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder="git@github.com:owner/repo.git or https://github.com/owner/repo"
            className="mt-1"
            data-testid="project-repo-url-input"
          />
          <span className="mt-1 block text-[11px] text-txt-tertiary">
            Normalized on save. SSH and HTTPS variants of the same remote collapse to one canonical URL.
          </span>
        </label>
        <div className="flex items-center gap-2">
          <Button
            onClick={save}
            disabled={saving}
            data-testid="project-settings-save"
          >
            {saving ? "Saving…" : "Save"}
          </Button>
          {savedAt ? (
            <span className="text-[11px] text-success" data-testid="project-settings-saved">
              Saved
            </span>
          ) : null}
          {error ? (
            <span className="text-[11px] text-danger" data-testid="project-settings-error">
              {error}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

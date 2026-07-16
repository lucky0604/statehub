"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Input } from "../ui/input";
import { Button } from "../ui/button";

/**
 * RepoAliasManager — list/add/remove a project's repo aliases.
 *
 * Source: agent_flow/implementation/v1/iterations/20260716-p04c-ui-docs-e2e/plan.md §2.1
 *
 * Aliases are supplemental remote URLs that should match the local repo when
 * the canonical repo_url doesn't. The (workspace_id, alias_url) UNIQUE
 * constraint means each URL can only attach to one project per workspace.
 *
 * Calls the P04A API routes; router.refresh() updates the list without a full
 * page reload.
 */
interface Alias {
  id: string;
  aliasUrl: string;
  createdAt: number;
}

interface Props {
  workspaceId: string;
  projectId: string;
  aliases: Alias[];
}

export function RepoAliasManager({ workspaceId, projectId, aliases }: Props) {
  const router = useRouter();
  const [newAlias, setNewAlias] = useState("");
  const [adding, startAdd] = useTransition();
  const [removing, startRemove] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function add() {
    if (!newAlias.trim()) return;
    setError(null);
    const value = newAlias.trim();
    startAdd(async () => {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/projects/${projectId}/repo-aliases`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ alias_url: value }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.message ?? `add failed (status ${res.status})`);
        return;
      }
      setNewAlias("");
      router.refresh();
    });
  }

  function remove(aliasId: string) {
    setError(null);
    startRemove(async () => {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/projects/${projectId}/repo-aliases/${aliasId}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.message ?? `remove failed (status ${res.status})`);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="rounded-md border border-border-subtle bg-surface-1 p-4">
      <div className="text-[11px] font-medium uppercase tracking-wide text-txt-tertiary">
        Repo Aliases
      </div>
      <p className="mt-1 text-[11px] text-txt-tertiary">
        Supplemental remote URLs that should match the local repo. The canonical repo_url is set above; add aliases for forks, mirrors, or alternate protocols.
      </p>

      <ul className="mt-3 space-y-1.5" data-testid="repo-alias-list">
        {aliases.length === 0 ? (
          <li className="text-[12px] italic text-txt-tertiary">No aliases yet.</li>
        ) : (
          aliases.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between rounded-md border border-border-subtle bg-surface-2 px-3 py-1.5"
            >
              <span className="font-mono-app text-[12px] text-txt-primary">{a.aliasUrl}</span>
              <button
                onClick={() => remove(a.id)}
                disabled={removing}
                className="rounded-xs px-1.5 py-0.5 text-[11px] text-danger hover:bg-danger/10 disabled:opacity-50"
                aria-label={`Remove alias ${a.aliasUrl}`}
                data-testid={`repo-alias-remove-${a.id}`}
              >
                ✕
              </button>
            </li>
          ))
        )}
      </ul>

      <div className="mt-3 flex items-center gap-2">
        <Input
          value={newAlias}
          onChange={(e) => setNewAlias(e.target.value)}
          placeholder="git@github.com:owner/repo-fork.git"
          className="flex-1"
          data-testid="repo-alias-input"
        />
        <Button onClick={add} disabled={adding || !newAlias.trim()} data-testid="repo-alias-add">
          {adding ? "Adding…" : "Add"}
        </Button>
      </div>
      {error ? (
        <p className="mt-2 text-[11px] text-danger" data-testid="repo-alias-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

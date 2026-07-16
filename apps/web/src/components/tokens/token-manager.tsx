"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Trash2 } from "lucide-react";
import type { IssuedToken, TokenScope } from "@statehub/domain";
import { api, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";

/**
 * Token manager — issue + list + revoke personal tokens.
 *
 * Source: agent_flow/implementation/v1/phases/phase-02-minimum-agent-sync-loop.md §5
 *         agent_flow/implementation/v1/iterations/.../plan.md §3 (decisions)
 *
 * The raw token is returned ONCE on issuance; we show it in a one-time banner
 * with a copy button. Refreshing the page hides it (only the prefix remains).
 * The UI never re-fetches the raw token — it is not stored.
 */
interface Props {
  workspaceId: string;
  /** Initial list of non-revoked tokens (server-fetched). */
  initial: {
    id: string;
    name: string;
    prefix: string;
    scopes: TokenScope[];
    lastUsedAt: number | null;
    createdAt: number;
  }[];
}

const ALL_SCOPES: { value: TokenScope; label: string; hint: string }[] = [
  { value: "read", label: "read", hint: "Call get_current_focus / get_feature_context" },
  { value: "write_agent_state", label: "write_agent_state", hint: "start / complete agent runs" },
  { value: "write_review", label: "write_review", hint: "submit reviews (Phase 03)" },
];

type TokenRow = Props["initial"][number];

export function TokenManager({ workspaceId, initial }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [tokens, setTokens] = useState<TokenRow[]>(initial);
  const [newName, setNewName] = useState("");
  const [newScopes, setNewScopes] = useState<TokenScope[]>(["read", "write_agent_state"]);
  const [issued, setIssued] = useState<IssuedToken | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const basePath = `/api/workspaces/${workspaceId}/tokens`;

  const refresh = useCallback(() => {
    startTransition(() => router.refresh());
  }, [router, startTransition]);

  async function issue(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim() || busy) return;
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const result = await api.post<IssuedToken>(basePath, { name: newName, scopes: newScopes });
      setIssued(result);
      setNewName("");
      // Optimistic add (without raw token).
      setTokens((prev) => [
        {
          id: result.tokenId,
          name: result.name,
          prefix: result.prefix,
          scopes: result.scopes,
          lastUsedAt: null,
          createdAt: Date.now(),
        },
        ...prev,
      ]);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to issue token");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    if (revokingId) return;
    setRevokingId(id);
    setError(null);
    try {
      await api.post(`${basePath}/${id}/revoke`, {});
      setTokens((prev) => prev.filter((t) => t.id !== id));
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to revoke token");
    } finally {
      setRevokingId(null);
    }
  }

  async function copyToken(token: string) {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Clipboard write failed — copy manually.");
    }
  }

  // Clear the one-time banner if the issued token is the same one we already
  // showed (e.g. on a stray re-render). The banner is dismiss-only.
  useEffect(() => {
    if (!issued) return;
    // Auto-clear after 5 minutes to avoid leaving the raw token visible on a
    // forgotten tab. User can also dismiss manually.
    const t = setTimeout(() => setIssued(null), 5 * 60 * 1000);
    return () => clearTimeout(t);
  }, [issued]);

  function toggleScope(s: TokenScope) {
    setNewScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  return (
    <div className="space-y-4" data-testid="token-manager">
      {error ? <div className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-[12px] text-danger">{error}</div> : null}

      {issued ? (
        <div className="rounded-md border border-success/40 bg-success/5 p-3" data-testid="issued-token-banner">
          <div className="flex items-center justify-between">
            <div className="text-[12px] font-semibold text-success">
              Token issued — copy now, it won't be shown again
            </div>
            <button
              type="button"
              onClick={() => setIssued(null)}
              className="text-[11px] text-txt-tertiary hover:text-txt-primary"
            >
              dismiss
            </button>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 truncate rounded-md border border-border-subtle bg-surface-1 px-2.5 py-1.5 font-mono-app text-[12px] text-txt-primary">
              {issued.token}
            </code>
            <Button
              type="button"
              variant="neutral"
              size="sm"
              onClick={() => void copyToken(issued.token)}
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "copied" : "copy"}
            </Button>
          </div>
          <p className="mt-1.5 text-[11px] text-txt-tertiary">
            Store this in your agent's config (e.g. <code className="font-mono-app">.opencode/config.json</code>).
            The token is hashed at rest; we can't recover it for you.
          </p>
        </div>
      ) : null}

      {/* Issue form */}
      <form
        onSubmit={issue}
        className="rounded-md border border-border-subtle bg-surface-1 p-3"
      >
        <div className="text-[11px] font-medium uppercase tracking-wide text-txt-tertiary">
          Issue new token
        </div>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="flex-1 min-w-[180px]">
            <span className="text-[11px] text-txt-tertiary">Name</span>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. opencode-local"
              className="mt-0.5 h-8 w-full rounded-md border border-border-subtle bg-surface-2 px-2.5 text-[13px] text-txt-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
            />
          </label>
          <Button type="submit" variant="primary" size="md" disabled={busy || !newName.trim()}>
            {busy ? "issuing…" : "issue"}
          </Button>
        </div>
        <div className="mt-2">
          <span className="text-[11px] text-txt-tertiary">Scopes</span>
          <div className="mt-1 space-y-1">
            {ALL_SCOPES.map((s) => {
              const checked = newScopes.includes(s.value);
              return (
                <label
                  key={s.value}
                  className="flex items-start gap-2 text-[12px] text-txt-secondary"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleScope(s.value)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-mono-app text-txt-primary">{s.label}</span>
                    <span className="ml-1.5 text-txt-tertiary">{s.hint}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      </form>

      {/* List */}
      <div className="rounded-md border border-border-subtle bg-surface-1 p-3">
        <div className="text-[11px] font-medium uppercase tracking-wide text-txt-tertiary">
          Active tokens ({tokens.length})
        </div>
        {tokens.length === 0 ? (
          <p className="mt-1.5 text-[12px] italic text-txt-tertiary">
            No tokens yet. Issue one above and paste it into your agent's config.
          </p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {tokens.map((t) => (
              <li
                key={t.id}
                className="flex items-center gap-3 rounded-md border border-border-subtle bg-surface-2 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-txt-primary">{t.name}</span>
                    <code className="font-mono-app text-[11px] text-txt-tertiary">{t.prefix}…</code>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-txt-tertiary">
                    {t.scopes.map((s) => (
                      <span
                        key={s}
                        className="rounded-xs bg-layer-2 px-1.5 py-0.5 font-mono-app"
                      >
                        {s}
                      </span>
                    ))}
                    <span>·</span>
                    <span>created {new Date(t.createdAt).toLocaleDateString()}</span>
                    {t.lastUsedAt ? (
                      <>
                        <span>·</span>
                        <span>last used {new Date(t.lastUsedAt).toLocaleString()}</span>
                      </>
                    ) : null}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  onClick={() => void revoke(t.id)}
                  disabled={revokingId === t.id}
                  aria-label={`Revoke token ${t.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {revokingId === t.id ? "revoking…" : "revoke"}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Docs link */}
      <div className="rounded-md border border-border-subtle bg-surface-1 p-3 text-[12px] text-txt-secondary">
        Need help connecting an agent? See{" "}
        <a href="/docs/mcp/first-sync.md" className="text-accent hover:underline" target="_blank" rel="noreferrer">
          the first-sync walkthrough
        </a>{" "}
        and the{" "}
        <a href="/docs/mcp/tool-reference.md" className="text-accent hover:underline" target="_blank" rel="noreferrer">
          tool reference
        </a>
        .
      </div>
    </div>
  );
}

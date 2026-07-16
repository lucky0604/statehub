"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import type { AgentRun, Evidence, Todo } from "@statehub/domain";
import { api, ApiError } from "@/lib/api-client";
import { EvidenceTrustBadge } from "@/components/evidence/evidence-trust-badge";
import { StalenessBadge } from "@/components/evidence/staleness-badge";

/**
 * Agent Run Detail Drawer — right-side overlay, mirrors PeekDrawer's pattern.
 *
 * Source: agent_flow/implementation/v1/phases/phase-02-minimum-agent-sync-loop.md §6.1
 *         agent_flow/statehub-design-system.md §11.3
 *
 * Opens via ?run=<id> on the agent-runs page and the feature detail page.
 * Escape closes (removes ?run). Fetches { run, evidence, todos } from the API.
 */
interface Props {
  workspaceId: string;
  runId: string;
  onClose: () => void;
}

type RunWithEvidence = { run: AgentRun; evidence: Evidence[]; todos: Todo[] };

function parseJsonArray(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export function AgentRunDetailDrawer({ workspaceId, runId, onClose }: Props) {
  const router = useRouter();
  const [data, setData] = useState<RunWithEvidence | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const basePath = `/api/workspaces/${workspaceId}/agent-runs/${runId}`;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await api.get<RunWithEvidence>(basePath);
      setData(d);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load agent run");
    } finally {
      setLoading(false);
    }
  }, [basePath]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const run = data?.run;

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/30" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-label="Agent run detail"
        className="fixed right-0 top-0 z-40 flex h-full w-[min(640px,100vw)] flex-col border-l border-border-subtle bg-surface-1 shadow-2xl"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border-subtle px-4 py-3">
          {run ? (
            <div className="flex items-center gap-2">
              <span className="font-mono-app text-[12px] text-accent">{run.agent}</span>
              <span className="rounded-xs bg-layer-2 px-1.5 py-0.5 text-[11px] text-txt-secondary">
                {run.runType}
              </span>
              <span className="text-[11px] capitalize text-txt-tertiary">{run.status}</span>
            </div>
          ) : (
            <span className="text-[12px] text-txt-tertiary">Loading…</span>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-txt-tertiary hover:bg-surface-2 hover:text-txt-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {loading ? (
            <div className="text-[13px] text-txt-tertiary">Loading…</div>
          ) : error ? (
            <div className="text-[13px] text-danger">{error}</div>
          ) : run ? (
            <div className="space-y-4">
              {/* Summary */}
              <div>
                <div className="mb-1 text-[10px] uppercase tracking-wide text-txt-tertiary">
                  Summary
                </div>
                <p className="whitespace-pre-wrap rounded-md border border-border-subtle bg-surface-2 p-3 text-[13px] leading-relaxed text-txt-primary">
                  {run.summary ?? "No summary recorded."}
                </p>
              </div>

              {/* Props */}
              <div className="grid grid-cols-2 gap-2 text-[12px]">
                <Prop label="Agent">
                  <span className="text-txt-secondary">{run.agent}</span>
                </Prop>
                <Prop label="Model">
                  <span className="font-mono-app text-txt-secondary">
                    {run.model ?? "—"}
                  </span>
                </Prop>
                <Prop label="Run type">
                  <span className="text-txt-secondary">{run.runType}</span>
                </Prop>
                <Prop label="Status">
                  <span className="capitalize text-txt-secondary">{run.status}</span>
                </Prop>
                <Prop label="Started">
                  <span className="text-txt-secondary">
                    {new Date(run.startedAt).toLocaleString()}
                  </span>
                </Prop>
                <Prop label="Finished">
                  <span className="text-txt-secondary">
                    {run.finishedAt ? new Date(run.finishedAt).toLocaleString() : "—"}
                  </span>
                </Prop>
                <Prop label="Trust state">
                  <span className="text-txt-secondary">{run.evidenceTrustState.replace("_", " ")}</span>
                </Prop>
                <Prop label="Git branch">
                  <span className="font-mono-app text-txt-secondary">
                    {run.gitBranch ?? "—"}
                  </span>
                </Prop>
              </div>

              {/* Files changed */}
              <Section title="Files changed" items={parseJsonArray(run.filesChangedJson)} mono />

              {/* Commands run */}
              <Section title="Commands run" items={parseJsonArray(run.commandsRunJson)} mono />

              {/* Test result */}
              <div>
                <div className="mb-1 text-[10px] uppercase tracking-wide text-txt-tertiary">
                  Test result
                </div>
                {run.testResult ? (
                  <p className="rounded-md border border-success/30 bg-success/5 px-3 py-2 text-[13px] text-success">
                    {run.testResult}
                  </p>
                ) : (
                  <p className="text-[12px] italic text-warning">No test result recorded.</p>
                )}
              </div>

              {/* Risks */}
              <Section title="Risks" items={parseJsonArray((run as AgentRun).risksJson)} />

              {/* Next steps */}
              <Section title="Next steps" items={parseJsonArray((run as AgentRun).nextStepsJson)} />

              {/* Evidence */}
              <div>
                <div className="mb-1 text-[10px] uppercase tracking-wide text-txt-tertiary">
                  Evidence ({data!.evidence.length})
                </div>
                {data!.evidence.length === 0 ? (
                  <p className="text-[12px] italic text-txt-tertiary">No linked evidence.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {data!.evidence.map((e) => (
                      <li
                        key={e.id}
                        className="rounded-md border border-border-subtle bg-surface-2 px-3 py-2"
                      >
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[13px] font-medium text-txt-primary">
                            {e.title}
                          </span>
                          <EvidenceTrustBadge state={e.trustState} />
                          <StalenessBadge state={e.stalenessState} />
                        </div>
                        {e.summary ? (
                          <p className="mt-0.5 text-[12px] text-txt-secondary">{e.summary}</p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Todos */}
              <div>
                <div className="mb-1 text-[10px] uppercase tracking-wide text-txt-tertiary">
                  Todos ({data!.todos.length})
                </div>
                {data!.todos.length === 0 ? (
                  <p className="text-[12px] italic text-txt-tertiary">No todos linked to this run.</p>
                ) : (
                  <ul className="space-y-1">
                    {data!.todos.map((t) => (
                      <li
                        key={t.id}
                        className="flex items-start gap-2 text-[12px]"
                      >
                        <span
                          className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                            t.status === "done"
                              ? "bg-success"
                              : t.status === "in_progress"
                                ? "bg-accent"
                                : "bg-txt-tertiary"
                          }`}
                          aria-hidden
                        />
                        <span
                          className={
                            t.status === "done" || t.status === "cancelled"
                              ? "text-txt-tertiary line-through"
                              : "text-txt-primary"
                          }
                        >
                          {t.title}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        {run ? (
          <div className="shrink-0 border-t border-border-subtle px-4 py-2 text-[10px] text-txt-tertiary">
            <span className="font-mono-app">{run.id}</span>
            <button
              type="button"
              onClick={() => {
                router.refresh();
                void load();
              }}
              className="ml-3 text-accent hover:underline"
            >
              refresh
            </button>
          </div>
        ) : null}
      </aside>
    </>
  );
}

function Prop({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border-subtle bg-surface-2 px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-txt-tertiary">{label}</div>
      <div className="mt-0.5 text-[12px] text-txt-primary">{children}</div>
    </div>
  );
}

function Section({
  title,
  items,
  mono,
}: {
  title: string;
  items: string[];
  mono?: boolean;
}) {
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wide text-txt-tertiary">
        {title} ({items.length})
      </div>
      {items.length === 0 ? (
        <p className="text-[12px] italic text-txt-tertiary">None.</p>
      ) : (
        <ul className="space-y-1">
          {items.map((it, i) => (
            <li
              key={i}
              className={`rounded-md border border-border-subtle bg-surface-2 px-2.5 py-1.5 text-[12px] text-txt-secondary ${
                mono ? "font-mono-app" : ""
              }`}
            >
              {it}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

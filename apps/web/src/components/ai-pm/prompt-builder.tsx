"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import type { AIPmMode, AnswerEnvelope, AiPmActionCard } from "@statehub/domain";

/**
 * Prompt Builder — generates a coding-agent prompt via the AI PM's
 * prompt_builder mode. The prompt is returned as a generate_agent_prompt
 * action card; applying it returns the prompt text inline.
 *
 * Source: phase-05 §3.5 (prompt_builder mode), §6.4 (UI).
 */
interface Props {
  workspaceId: string;
  projectId: string | null;
  featureId: string | null;
}

type Agent = "opencode" | "codex";
type PromptKind = "implement" | "fix" | "release";

export function PromptBuilder({ workspaceId, projectId, featureId }: Props) {
  const [agent, setAgent] = useState<Agent>("opencode");
  const [kind, setKind] = useState<PromptKind>("implement");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setError(null);
    setPrompt(null);
    try {
      const result = await api.post<{
        query_id: string;
        answer: AnswerEnvelope;
        action_cards: AiPmActionCard[];
      }>(`/api/workspaces/${workspaceId}/ai-pm/query`, {
        mode: "prompt_builder" satisfies AIPmMode,
        project_id: projectId,
        feature_id: featureId,
        question: JSON.stringify({ agent, prompt_kind: kind, notes }),
      });
      // Find the generate_agent_prompt card and apply it to get the prompt text.
      const card = result.action_cards.find(
        (c) => c.actionType === "generate_agent_prompt",
      );
      if (!card) {
        setError("AI PM did not return a generate_agent_prompt card");
        return;
      }
      const applied = await api.post<{
        result: { kind: string; prompt: string };
      }>(`/api/workspaces/${workspaceId}/ai-pm/actions/${card.id}/apply`, {});
      if (applied.result.kind === "generate_agent_prompt") {
        setPrompt(applied.result.prompt);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Generate failed");
    } finally {
      setBusy(false);
    }
  }

  async function copyPrompt() {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      // Clipboard may be unavailable in non-secure contexts; fail silently.
    }
  }

  return (
    <div
      className="rounded-md border border-border-subtle bg-surface-1 p-4"
      data-testid="prompt-builder"
    >
      <h3 className="text-[14px] font-semibold text-txt-primary">
        Prompt Builder
      </h3>
      <p className="mt-1 text-[12px] text-txt-secondary">
        Generate a coding-agent prompt with MCP sync instructions.
      </p>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-txt-tertiary">
            Agent
          </span>
          <select
            value={agent}
            onChange={(e) => setAgent(e.target.value as Agent)}
            disabled={busy}
            className="h-8 rounded-md border border-border-subtle bg-surface-2 px-2 text-[12px] text-txt-primary"
            data-testid="prompt-agent-select"
          >
            <option value="opencode">OpenCode</option>
            <option value="codex">Codex</option>
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-txt-tertiary">
            Prompt kind
          </span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as PromptKind)}
            disabled={busy}
            className="h-8 rounded-md border border-border-subtle bg-surface-2 px-2 text-[12px] text-txt-primary"
            data-testid="prompt-kind-select"
          >
            <option value="implement">Implement</option>
            <option value="fix">Fix</option>
            <option value="release">Release</option>
          </select>
        </label>
      </div>

      <label className="mt-3 flex flex-col gap-1">
        <span className="text-[11px] font-medium uppercase tracking-wide text-txt-tertiary">
          Notes (optional)
        </span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          disabled={busy}
          placeholder="Specific instructions for the agent…"
          className="rounded-md border border-border-subtle bg-surface-2 p-2 text-[12px] text-txt-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
        />
      </label>

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void generate()}
          className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-on-accent disabled:opacity-50"
          data-testid="prompt-generate-btn"
        >
          {busy ? "Generating…" : "Generate prompt"}
        </button>
        {prompt ? (
          <button
            type="button"
            onClick={() => void copyPrompt()}
            className="rounded-md border border-border-subtle bg-surface-2 px-3 py-1.5 text-[12px] text-txt-secondary hover:bg-surface-1"
          >
            Copy
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="mt-2 text-[12px] text-danger" role="alert">
          {error}
        </p>
      ) : null}

      {prompt ? (
        <pre
          className="mt-3 max-h-80 overflow-auto rounded-md border border-border-subtle bg-surface-2 p-3 text-[11px] font-mono text-txt-secondary whitespace-pre-wrap"
          data-testid="prompt-output"
        >
          {prompt}
        </pre>
      ) : null}
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type {
  AIPmMode,
  AnswerEnvelope,
  AiPmActionCard,
  Project,
  Feature,
} from "@statehub/domain";
import { cn } from "@/lib/cn";
import { api, ApiError } from "@/lib/api-client";
import { AIAnswerBlock } from "./ai-answer-block";
import { ActionCardList } from "./action-card-list";
import { WeeklyReviewView } from "./weekly-review-view";
import { PromptBuilder } from "./prompt-builder";
import type { WeeklyReview } from "@statehub/domain";

/**
 * AI PM Dock — the main interactive surface for the AI PM.
 *
 * Source: phase-05 §6.1 (dock), §3 (modes).
 *
 * Server component renders the initial pending cards + weekly reviews; this
 * client component handles mode switching + query + apply/dismiss mutations.
 * After each mutation, router.refresh() re-renders the server component with
 * fresh data.
 */
interface Props {
  workspaceId: string;
  projects: Project[];
  features: Feature[];
  initialCards: AiPmActionCard[];
  weeklyReviews: WeeklyReview[];
}

const MODES: Array<{ id: AIPmMode; label: string; hint: string }> = [
  { id: "advisor", label: "Advisor", hint: "Read-only state summary + risks + next action" },
  { id: "plan", label: "Plan", hint: "Propose features/work items/acceptance criteria" },
  {
    id: "review_triage",
    label: "Review Triage",
    hint: "Must-fix vs can-defer for open findings",
  },
  {
    id: "weekly_review",
    label: "Weekly Review",
    hint: "Completed / stalled / risks / next-week focus",
  },
  {
    id: "prompt_builder",
    label: "Prompt Builder",
    hint: "Generate OpenCode/Codex/fix/release prompts",
  },
];

export function AIPMDock({
  workspaceId,
  projects,
  features,
  initialCards,
  weeklyReviews,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const [mode, setMode] = useState<AIPmMode>(
    (searchParams.get("mode") as AIPmMode | null) ?? "advisor",
  );
  const [projectId, setProjectId] = useState<string>(
    searchParams.get("project_id") ?? projects[0]?.id ?? "",
  );
  const [featureId, setFeatureId] = useState<string>(
    searchParams.get("feature_id") ?? "",
  );
  const [answer, setAnswer] = useState<AnswerEnvelope | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const featuresForProject = features.filter(
    (f) => !projectId || f.projectId === projectId,
  );

  async function runQuery() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{
        query_id: string;
        answer: AnswerEnvelope;
        action_cards: AiPmActionCard[];
      }>(`/api/workspaces/${workspaceId}/ai-pm/query`, {
        mode,
        project_id: projectId || null,
        feature_id: featureId || null,
      });
      setAnswer(result.answer);
      // The query persists new cards with status="pending". Refresh the
      // server component so initialCards includes them — the dock always
      // renders from initialCards so apply/dismiss mutations stay in sync
      // with the server's view of card status.
      router.refresh();
      // Update URL so refresh preserves the mode/context.
      const params = new URLSearchParams();
      params.set("mode", mode);
      if (projectId) params.set("project_id", projectId);
      if (featureId) params.set("feature_id", featureId);
      startTransition(() =>
        router.replace(`/workspaces/${workspaceId}/ai-pm?${params.toString()}`),
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Query failed");
    } finally {
      setBusy(false);
    }
  }

  function switchMode(newMode: AIPmMode) {
    setMode(newMode);
    setAnswer(null);
    setError(null);
  }

  // Cards come from the server (initialCards) so the dock always reflects
  // the DB's view of card status. router.refresh() after each mutation
  // (query/apply/dismiss) keeps this list fresh.
  const cardsToShow = initialCards;

  return (
    <div className="flex flex-col gap-4" data-testid="ai-pm-dock">
      {/* Mode tabs */}
      <div
        className="flex flex-wrap gap-1 rounded-md border border-border-subtle bg-surface-1 p-1"
        role="tablist"
        aria-label="AI PM mode"
      >
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="tab"
            aria-selected={mode === m.id}
            onClick={() => switchMode(m.id)}
            className={cn(
              "rounded px-2.5 py-1 text-[12px] font-medium transition-colors",
              mode === m.id
                ? "bg-accent text-on-accent"
                : "text-txt-secondary hover:bg-surface-2 hover:text-txt-primary",
            )}
            data-testid={`mode-tab-${m.id}`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Context selectors + run button */}
      <div className="rounded-md border border-border-subtle bg-surface-1 p-3">
        <p className="mb-2 text-[12px] text-txt-secondary">
          {MODES.find((m) => m.id === mode)?.hint}
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wide text-txt-tertiary">
              Project
            </span>
            <select
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value);
                setFeatureId("");
              }}
              disabled={busy}
              className="h-8 rounded-md border border-border-subtle bg-surface-2 px-2 text-[12px] text-txt-primary"
              data-testid="project-select"
            >
              <option value="">(workspace-wide)</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium uppercase tracking-wide text-txt-tertiary">
              Feature
            </span>
            <select
              value={featureId}
              onChange={(e) => setFeatureId(e.target.value)}
              disabled={busy || featuresForProject.length === 0}
              className="h-8 rounded-md border border-border-subtle bg-surface-2 px-2 text-[12px] text-txt-primary"
              data-testid="feature-select"
            >
              <option value="">(any)</option>
              {featuresForProject.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void runQuery()}
            className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-on-accent disabled:opacity-50"
            data-testid="run-query-btn"
          >
            {busy ? "Querying…" : `Run ${MODES.find((m) => m.id === mode)?.label}`}
          </button>
        </div>

        {error ? (
          <p className="mt-2 text-[12px] text-danger" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      {/* Prompt builder mode has its own UI; render it instead of the answer. */}
      {mode === "prompt_builder" ? (
        <PromptBuilder
          workspaceId={workspaceId}
          projectId={projectId || null}
          featureId={featureId || null}
        />
      ) : null}

      {/* Weekly review mode shows saved reviews alongside the query result. */}
      {mode === "weekly_review" ? (
        <section>
          <h3 className="mb-2 text-[13px] font-semibold text-txt-primary">
            Saved weekly reviews
          </h3>
          <WeeklyReviewView reviews={weeklyReviews} />
        </section>
      ) : null}

      {/* Answer block from the most recent query. */}
      {answer ? (
        <section>
          <h3 className="mb-2 text-[13px] font-semibold text-txt-primary">
            Latest answer
          </h3>
          <AIAnswerBlock answer={answer} />
        </section>
      ) : null}

      {/* Action cards. */}
      {mode !== "prompt_builder" ? (
        <section>
          <h3 className="mb-2 text-[13px] font-semibold text-txt-primary">
            Action cards
          </h3>
          <ActionCardList workspaceId={workspaceId} cards={cardsToShow} />
        </section>
      ) : null}
    </div>
  );
}

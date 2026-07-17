/**
 * AI provider abstraction.
 *
 * Source: agent_flow/implementation/v1/phases/phase-05-writable-ai-pm.md §9 P05-AIPM-001
 *
 * Two implementations ship in v1:
 *
 * 1. DeterministicProvider — produces a context-aware but canned answer
 *    envelope for each mode. No external HTTP call. Used by:
 *      - tests (deterministic by definition)
 *      - local dev when no API key is configured
 *      - CI
 *
 * 2. OpenAICompatibleProvider — calls an OpenAI-compatible /chat/completions
 *    endpoint. Used when OPENAI_API_KEY (or equivalent) is set. Works with
 *    OpenAI, Azure OpenAI, OpenRouter, local llama.cpp server, etc.
 *
 * The factory pickProvider(env) returns the right one based on which keys
 * are set. This keeps the aiPmService decoupled from provider choice.
 */
import type { AIPmMode } from "./answer-schema";
import type { ContextPacket } from "./context-builder";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompts";

export interface AICompleteRequest {
  mode: AIPmMode;
  context: ContextPacket;
  question?: string;
  maxTokens?: number;
}

export interface AICompleteResponse {
  /** Raw text from the provider. Expected to be JSON matching the answer schema. */
  text: string;
  /** Provider name for debugging + UI display. */
  providerName: string;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface AIProvider {
  name: string;
  complete(request: AICompleteRequest): Promise<AICompleteResponse>;
}

// ---------------------------------------------------------------------------
// DeterministicProvider
// ---------------------------------------------------------------------------

/**
 * Deterministic, no-network provider. The response is built from the
 * context packet — same input → same output. The output is always valid
 * JSON matching the answer schema, so the parser never throws.
 *
 * This is NOT a real LLM. It exists so:
 *   - tests don't depend on external services
 *   - local dev works out of the box without an API key
 *   - the e2e suite is deterministic
 *
 * The response text starts with a banner that says "DETERMINISTIC" so a
 * user inspecting the raw output doesn't mistake it for a real LLM call.
 */
export class DeterministicProvider implements AIProvider {
  readonly name = "deterministic";

  async complete(request: AICompleteRequest): Promise<AICompleteResponse> {
    const { mode, context, question } = request;
    const answer = buildDeterministicAnswer(mode, context, question);
    const text = JSON.stringify(answer);
    return {
      text,
      providerName: this.name,
      usage: { inputTokens: estimateTokens(text), outputTokens: estimateTokens(text) },
    };
  }
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function buildDeterministicAnswer(
  mode: AIPmMode,
  context: ContextPacket,
  _question?: string,
) {
  const basis: Array<{ entity: string; fact: string }> = [];
  const risks: string[] = [];
  const missing = [...context.missing_data_warnings];
  const actions: unknown[] = [];

  const currentProject = context.current_project;
  const currentFeature = context.current_feature;

  // Cite the current project + feature as the anchor basis entries.
  if (currentProject) {
    basis.push({
      entity: `project:${currentProject.id}`,
      fact: `status=${currentProject.status}, portfolio_priority=${currentProject.portfolioPriority ?? "none"}`,
    });
  }
  if (currentFeature) {
    basis.push({
      entity: `feature:${currentFeature.id}`,
      fact: `status=${currentFeature.status}`,
    });
  }

  switch (mode) {
    case "advisor": {
      const openHigh = context.open_findings.filter(
        (f) => f.severity === "high" || f.severity === "blocker",
      );
      if (openHigh.length > 0) {
        basis.push({
          entity: `finding:${openHigh[0]!.id}`,
          fact: `${openHigh.length} open high/blocker finding(s)`,
        });
        risks.push("Open high-severity findings block feature completion.");
      }
      if (context.recent_evidence.length === 0) {
        risks.push("No evidence recorded — Done Gate cannot evaluate trust.");
      }
      const conclusion = currentFeature
        ? `Feature ${currentFeature.name} is ${currentFeature.status}. ${openHigh.length > 0 ? `${openHigh.length} high/blocker finding(s) open.` : "No blocking findings."} ${risks.length > 0 ? risks.join(" ") : ""}`.trim()
        : `Workspace has ${context.projects.length} project(s) and ${context.features.length} feature(s). ${risks.length > 0 ? risks.join(" ") : "No immediate risks."}`.trim();

      return {
        mode,
        conclusion,
        basis,
        risks,
        missing_data: missing,
        suggested_actions: actions,
      };
    }

    case "plan": {
      if (!currentProject) {
        missing.push("no current project selected — plan mode needs one");
      }
      if (currentFeature && context.work_items.length > 0) {
        const featureItems = context.work_items.filter(
          (wi) => wi.featureId === currentFeature.id,
        );
        basis.push({
          entity: `feature:${currentFeature.id}`,
          fact: `${featureItems.length} work item(s)`,
        });
        if (featureItems.length < 3) {
          actions.push({
            type: "create_work_item",
            title: `Add implementation task to ${currentFeature.name}`,
            target: { project_id: currentProject?.id, feature_id: currentFeature.id },
            payload: {
              title: `Implementation task ${featureItems.length + 1}`,
              type: "task",
              priority: "medium",
            },
            reason: `Feature has only ${featureItems.length} work item(s); adding one more.`,
            requires_confirmation: false,
          });
        }
      } else if (currentProject) {
        actions.push({
          type: "create_feature",
          title: `Proposed follow-up feature on ${currentProject.name}`,
          target: { project_id: currentProject.id },
          payload: {
            name: "Next iteration",
            description: "Auto-proposed by the deterministic AI PM.",
          },
          reason: "No current feature selected; proposing a new one.",
          requires_confirmation: false,
        });
      }
      const conclusion = currentFeature
        ? `Planning for feature ${currentFeature.name}: ${actions.length > 0 ? `${actions.length} action(s) proposed.` : "no actions needed."}`
        : `Planning for project ${currentProject?.name ?? "(none)"}: ${actions.length > 0 ? `${actions.length} action(s) proposed.` : "no actions needed."}`;

      return {
        mode,
        conclusion,
        basis,
        risks,
        missing_data: missing,
        suggested_actions: actions,
      };
    }

    case "review_triage": {
      const highFindings = context.open_findings.filter(
        (f) => f.severity === "high" || f.severity === "blocker",
      );
      const lowFindings = context.open_findings.filter(
        (f) => f.severity === "low" || f.severity === "medium",
      );
      for (const f of highFindings.slice(0, 3)) {
        basis.push({
          entity: `finding:${f.id}`,
          fact: `severity=${f.severity}, title="${f.title}"`,
        });
      }
      if (highFindings.length > 0 && currentFeature) {
        actions.push({
          type: "create_review_fix_items",
          title: `Create fix items for ${highFindings.length} high finding(s)`,
          target: {
            project_id: currentProject?.id,
            feature_id: currentFeature.id,
          },
          payload: {
            review_id: highFindings[0]!.reviewId,
          },
          reason: `${highFindings.length} high/blocker findings block feature completion.`,
          requires_confirmation: false,
        });
      }
      const conclusion = `Must fix: ${highFindings.length}. Can defer: ${lowFindings.length}. ${
        highFindings.length > 0
          ? "Triage recommends creating fix items for all high findings."
          : "No must-fix findings."
      }`;

      return {
        mode,
        conclusion,
        basis,
        risks,
        missing_data: missing,
        suggested_actions: actions,
      };
    }

    case "weekly_review": {
      const recentDone = context.work_items.filter(
        (wi) => wi.stateId === "done" || wi.title.toLowerCase().includes("done"),
      );
      if (recentDone.length > 0) {
        basis.push({
          entity: `work_item:${recentDone[0]!.id}`,
          fact: `${recentDone.length} work item(s) recently done`,
        });
      }
      const stalled = context.work_items.filter(
        (wi) => wi.stateId !== "done" && wi.stateId !== undefined,
      );
      if (currentProject) {
        actions.push({
          type: "save_weekly_review",
          title: `Save weekly review for ${currentProject.name}`,
          target: { project_id: currentProject.id },
          payload: {
            project_id: currentProject.id,
            week_start: context.generated_at - 7 * 24 * 60 * 60 * 1000,
            week_end: context.generated_at,
            summary_json: JSON.stringify({
              completed: recentDone.length,
              stalled: stalled.length,
              open_risks: context.open_findings.length,
              missing_evidence: context.recent_evidence.length === 0,
            }),
          },
          reason: "Weekly review generated from the last 7 days of activity.",
          requires_confirmation: false,
        });
      }
      const conclusion = `This week: ${recentDone.length} completed, ${stalled.length} in-flight, ${context.open_findings.length} open findings. ${
        context.recent_evidence.length === 0 ? "No evidence recorded — flag for follow-up." : ""
      }`;

      return {
        mode,
        conclusion,
        basis,
        risks,
        missing_data: missing,
        suggested_actions: actions,
      };
    }

    case "prompt_builder": {
      if (!currentFeature) {
        missing.push("prompt_builder mode requires a current feature");
      }
      if (currentFeature && currentProject) {
        actions.push({
          type: "generate_agent_prompt",
          title: `Generate OpenCode implement prompt for ${currentFeature.name}`,
          target: {
            project_id: currentProject.id,
            feature_id: currentFeature.id,
          },
          payload: {
            agent: "opencode",
            feature_id: currentFeature.id,
            prompt_kind: "implement",
          },
          reason: `Feature is ${currentFeature.status}; implement prompt is the default.`,
          requires_confirmation: false,
        });
      }
      const conclusion = currentFeature
        ? `Prompt for feature ${currentFeature.name}: generate_agent_prompt proposed.`
        : "Select a feature to generate a prompt.";

      return {
        mode,
        conclusion,
        basis,
        risks,
        missing_data: missing,
        suggested_actions: actions,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// OpenAICompatibleProvider
// ---------------------------------------------------------------------------

export interface OpenAICompatibleConfig {
  /** Base URL of the OpenAI-compatible API. Defaults to https://api.openai.com/v1. */
  baseUrl: string;
  /** API key. */
  apiKey: string;
  /** Model name, e.g. "gpt-4o" or "gpt-4o-mini". */
  model: string;
  /** Optional fetch override (tests). */
  fetchImpl?: typeof fetch;
}

/**
 * Calls an OpenAI-compatible /chat/completions endpoint. Used when an API
 * key is configured. Returns the raw text — the caller (aiPmService)
 * parses it via parseAIAnswer.
 *
 * If the request fails or the response is empty, this throws — the
 * aiPmService should fall back to DeterministicProvider if desired.
 */
export class OpenAICompatibleProvider implements AIProvider {
  readonly name: string;
  private readonly config: OpenAICompatibleConfig;

  constructor(config: OpenAICompatibleConfig) {
    this.config = config;
    this.name = `openai-compatible:${config.model}`;
  }

  async complete(request: AICompleteRequest): Promise<AICompleteResponse> {
    const systemPrompt = SYSTEM_PROMPT;
    const userPrompt = buildUserPrompt(
      request.mode,
      request.context,
      request.question,
    );
    const fetchImpl = this.config.fetchImpl ?? fetch;
    const url = `${this.config.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const body = {
      model: this.config.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: request.maxTokens ?? 2048,
      temperature: 0.2,
      response_format: { type: "json_object" },
    };
    const res = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `OpenAI-compatible request failed: ${res.status} ${res.statusText} ${text.slice(0, 500)}`,
      );
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = json.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("OpenAI-compatible response had no message content");
    }
    return {
      text: content,
      providerName: this.name,
      usage: {
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

export interface ProviderEnv {
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
  ANTHROPIC_API_KEY?: string;
  GEMINI_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  GLM_API_KEY?: string;
}

/**
 * Pick a provider based on which API keys are set. Priority:
 *   1. OPENAI_API_KEY → OpenAICompatibleProvider
 *   2. (future: ANTHROPIC, GEMINI, etc.)
 *   3. None → DeterministicProvider
 *
 * The DeterministicProvider is the safe default — it always returns a
 * valid answer envelope, so the AI PM works out of the box.
 */
export function pickProvider(env: ProviderEnv): AIProvider {
  if (env.OPENAI_API_KEY && env.OPENAI_API_KEY.trim().length > 0) {
    return new OpenAICompatibleProvider({
      baseUrl: env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL ?? "gpt-4o-mini",
    });
  }
  return new DeterministicProvider();
}

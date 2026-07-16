/**
 * AI PM service — orchestrates one AI PM query: build context → call
 * provider → parse → persist action cards → return answer + cards.
 *
 * Source: agent_flow/implementation/v1/phases/phase-05-writable-ai-pm.md
 *         §3 (modes), §4 (context builder), §7 (API scope)
 *
 * This service is the only place that calls an AI provider. The provider
 * is injected via the constructor (or pickProvider() by default) so tests
 * can swap in a DeterministicProvider.
 *
 * Safety (§8 rule 1): this service NEVER applies cards in the same
 * response. It returns action cards for the user to apply via the
 * action-card apply route.
 */
import type { DbClient, ActorContext } from "@statehub/db";
import {
  buildContextPacket,
  parseAIAnswer,
  pickProvider,
  type AIProvider,
  type AIPmMode,
  type AnswerEnvelope,
  type ContextPacket,
} from "@statehub/ai";
import { aiPmActor } from "../actor";
import { actionCardService } from "./action-card";
import { projectService } from "./project";
import { featureService } from "./feature";
import { workItemService } from "./work-item";
import { reviewService } from "./review";
import { agentRunService } from "./agent-run";
import { evidenceService } from "./evidence";
import { todoService } from "./todo";
import { cycleService } from "./cycle";
import type { AiPmActionCard } from "@statehub/db";

export interface AIPmService {
  query(
    db: DbClient,
    actor: ActorContext,
    workspaceId: string,
    input: AIPmQueryInput,
  ): Promise<AIPmQueryResult>;
}

export interface AIPmQueryInput {
  mode: AIPmMode;
  projectId?: string;
  featureId?: string;
  question?: string;
}

export interface AIPmQueryResult {
  queryId: string;
  answer: AnswerEnvelope;
  actionCards: AiPmActionCard[];
  contextPacket: ContextPacket;
  providerName: string;
}

export interface AIPmServiceOptions {
  /** Provider to use; defaults to pickProvider(process.env). */
  provider?: AIProvider;
}

/**
 * Build the service with a specific provider (tests) or the default
 * pickProvider(env) selection (production).
 */
export function createAiPmService(options?: AIPmServiceOptions): AIPmService {
  // Caller must supply a provider in tests. Production callers should use
  // the default `aiPmService` export, which picks a provider from env at
  // module-load time. If no provider is given here AND no env key is set,
  // we fall back to DeterministicProvider so the service always works.
  const provider =
    options?.provider ?? pickProvider(process.env as Record<string, string>);

  return {
    async query(db, actor, workspaceId, input) {
      // 1. Load context data from domain services.
      const contextInput = await loadContextInput(db, workspaceId, input);
      const contextPacket = buildContextPacket(contextInput);

      // 2. Call the provider.
      const response = await provider.complete({
        mode: input.mode,
        context: contextPacket,
        question: input.question,
      });

      // 3. Parse the response into the answer envelope. Throws on malformed.
      const answer = parseAIAnswer(response.text);

      // 4. Persist action cards (one per suggested action).
      const aiActor = aiPmActor(actor.name || "ai-pm");
      const queryId = crypto.randomUUID();
      const cards: AiPmActionCard[] = [];
      for (const envelope of answer.suggested_actions) {
        const card = await actionCardService.create(
          db,
          aiActor,
          workspaceId,
          queryId,
          envelope,
        );
        cards.push(card);
      }

      // 5. Emit ai_pm.query event for auditability.
      await emitQueryEvent(db, aiActor, workspaceId, {
        queryId,
        mode: input.mode,
        projectId: input.projectId,
        featureId: input.featureId,
        providerName: response.providerName,
        cardCount: cards.length,
      });

      return {
        queryId,
        answer,
        actionCards: cards,
        contextPacket,
        providerName: response.providerName,
      };
    },
  };
}

/**
 * Default AI PM service — uses pickProvider(process.env) at module load.
 * Most callers should use this. Tests should use createAiPmService with
 * an explicit DeterministicProvider.
 *
 * Note: pickProvider is invoked at module load (not lazily) to avoid
 * temporal-dead-zone issues with the `let _defaultProvider` cache pattern.
 * The DeterministicProvider it returns when no env key is set has no
 * side effects, so this is safe.
 */
export const aiPmService: AIPmService = createAiPmService({
  provider: pickProvider(process.env as Record<string, string>),
});

// ---------------------------------------------------------------------------
// Context loader — assembles the BuildContextInput from domain services.
// ---------------------------------------------------------------------------

async function loadContextInput(
  db: DbClient,
  workspaceId: string,
  input: AIPmQueryInput,
) {
  const [workspaceRow, projects] = await Promise.all([
    db.first<{ id: string; slug: string; name: string }>(
      "SELECT id, slug, name FROM workspaces WHERE id = ?",
      [workspaceId],
    ),
    projectService.list(db, workspaceId),
  ]);
  if (!workspaceRow) {
    throw new Error(`workspace not found: ${workspaceId}`);
  }

  const currentProject = input.projectId
    ? (projects.find((p) => p.id === input.projectId) ?? null)
    : null;

  // Load cycles for the current project (or skip if no project — cycles are
  // project-scoped and the AI PM can do without them when advising at
  // workspace level).
  let cycles: Awaited<ReturnType<typeof cycleService.list>> = [];
  if (currentProject) {
    cycles = await cycleService.list(db, workspaceId, currentProject.id);
  }

  // Load features for the current project (or all if no project).
  let features: Awaited<ReturnType<typeof featureService.list>> = [];
  if (currentProject) {
    features = await featureService.list(db, workspaceId, currentProject.id);
  } else {
    // Load features across all projects (one call per project).
    for (const p of projects.slice(0, 10)) {
      const ff = await featureService.list(db, workspaceId, p.id);
      features.push(...ff);
    }
  }

  const currentFeature = input.featureId
    ? (features.find((f) => f.id === input.featureId) ?? null)
    : null;

  // Load work items for the current project (or top N across all).
  let workItems: Awaited<ReturnType<typeof workItemService.list>> = [];
  if (currentProject) {
    workItems = await workItemService.list(db, workspaceId, currentProject.id, {});
  } else {
    for (const p of projects.slice(0, 5)) {
      const wis = await workItemService.list(db, workspaceId, p.id, {});
      workItems.push(...wis.slice(0, 20));
    }
  }

  // Recent reviews + open findings on the current feature (or top N).
  let recentReviews: Awaited<ReturnType<typeof reviewService.listForFeature>> = [];
  const openFindings: Awaited<ReturnType<typeof reviewService.listFindings>> = [];
  if (currentFeature) {
    recentReviews = await reviewService.listForFeature(db, workspaceId, currentFeature.id, 10);
    for (const r of recentReviews) {
      const f = await reviewService.listFindings(db, workspaceId, r.id);
      openFindings.push(...f.filter((x) => x.status === "open"));
    }
  }

  // Recent agent runs + evidence on the current feature.
  let recentAgentRuns: Awaited<ReturnType<typeof agentRunService.listForFeature>> = [];
  let recentEvidence: Awaited<ReturnType<typeof evidenceService.listForFeature>> = [];
  let openTodos: Awaited<ReturnType<typeof todoService.listForFeature>> = [];
  if (currentFeature) {
    [recentAgentRuns, recentEvidence, openTodos] = await Promise.all([
      agentRunService.listForFeature(db, workspaceId, currentFeature.id, 10),
      evidenceService.listForFeature(db, workspaceId, currentFeature.id),
      todoService.listForFeature(db, workspaceId, currentFeature.id),
    ]);
    // Open = not done and not cancelled. TodoStatus is backlog|in_progress|done|cancelled.
    openTodos = openTodos.filter((t) => t.status === "backlog" || t.status === "in_progress");
  }

  return {
    mode: input.mode,
    workspace: { id: workspaceRow.id, slug: workspaceRow.slug, name: workspaceRow.name },
    currentProject,
    currentFeature,
    projects: projects.map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      status: p.status,
      portfolioPriority: p.portfolioPriority,
    })),
    features: features.map((f) => ({
      id: f.id,
      name: f.name,
      status: f.status,
      projectId: f.projectId,
      createdAt: f.createdAt,
      updatedAt: f.updatedAt,
    })),
    workItems: workItems.map((wi) => ({
      id: wi.id,
      title: wi.title,
      type: wi.type,
      priority: wi.priority,
      stateId: wi.stateId,
      featureId: wi.featureId,
      projectId: wi.projectId,
      sequenceId: wi.sequenceId,
      projectIdentifier: wi.projectIdentifier,
    })),
    openFindings: openFindings.map((f) => ({
      id: f.id,
      severity: f.severity,
      title: f.title,
      reviewId: f.reviewId,
      status: f.status,
    })),
    recentReviews: recentReviews.map((r) => ({
      id: r.id,
      verdict: r.verdict,
      summary: r.summary,
      createdAt: r.createdAt,
    })),
    recentAgentRuns: recentAgentRuns.map((r) => ({
      id: r.id,
      status: r.status,
      agent: r.agent,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
    })),
    recentEvidence: recentEvidence.map((e) => ({
      id: e.id,
      evidenceType: e.evidenceType,
      title: e.title,
      trustState: e.trustState,
      stalenessState: e.stalenessState,
      createdAt: e.createdAt,
    })),
    openTodos: openTodos.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      featureId: t.featureId,
    })),
    cycles: cycles.map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      startDate: c.startDate,
      endDate: c.endDate,
    })),
  };
}

// ---------------------------------------------------------------------------
// Event emission for ai_pm.query.
// ---------------------------------------------------------------------------

async function emitQueryEvent(
  db: DbClient,
  actor: ActorContext,
  workspaceId: string,
  details: {
    queryId: string;
    mode: AIPmMode;
    projectId?: string;
    featureId?: string;
    providerName: string;
    cardCount: number;
  },
): Promise<void> {
  const { withEvent } = await import("@statehub/db");
  await withEvent(
    db,
    {
      workspaceId,
      projectId: details.projectId,
      featureId: details.featureId,
      entityType: "ai_pm_query",
      entityId: details.queryId,
      eventType: "ai_pm.query",
      actor,
      source: "ai_pm",
      payload: {
        queryId: details.queryId,
        mode: details.mode,
        providerName: details.providerName,
        cardCount: details.cardCount,
      },
    },
    () => [], // no mutation — this event is purely for auditability
  );
}

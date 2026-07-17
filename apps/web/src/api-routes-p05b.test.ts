/**
 * P05B API integration tests — AI PM query/apply/dismiss + weekly-reviews +
 * decisions routes.
 *
 * Exercises the Next.js route handlers directly with constructed Request
 * objects against an in-memory DB. Verifies the envelope, status codes, and
 * the domain service wiring including the high-risk confirmation gate and
 * Done Gate blocking.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { setDbClient, createInMemoryDb } from "@statehub/db/node";
import {
  SOLO_ACTOR,
  workspaceService,
  projectService,
  featureService,
  actionCardService,
} from "@statehub/domain";
import type { DbClient } from "@statehub/db";

// Route handlers
import { POST as postQuery } from "../app/api/workspaces/[wid]/ai-pm/query/route";
import { POST as postApply } from "../app/api/workspaces/[wid]/ai-pm/actions/[actionId]/apply/route";
import { POST as postDismiss } from "../app/api/workspaces/[wid]/ai-pm/actions/[actionId]/dismiss/route";
import { GET as getWeeklyReviews, POST as postWeeklyReview } from "../app/api/workspaces/[wid]/weekly-reviews/route";
import { POST as postDecision } from "../app/api/workspaces/[wid]/decisions/route";

interface Env {
  db: DbClient;
  wid: string;
  projectId: string;
  featureId: string;
}

let env: Env;

beforeAll(async () => {
  const db = createInMemoryDb();
  setDbClient(db);
  const ws = await workspaceService.create(db, SOLO_ACTOR, {
    slug: "p05b-api-ws",
    name: "P05B API",
  });
  const project = await projectService.create(db, SOLO_ACTOR, ws.id, {
    slug: "proj",
    name: "P",
    identifier: "PBA",
  });
  const feature = await featureService.create(db, SOLO_ACTOR, ws.id, project.id, {
    name: "P05B API Feat",
    description: "F",
  });
  // backlog → planned → in_progress (intermediate transitions required by FSM).
  await featureService.changeStatus(db, SOLO_ACTOR, ws.id, feature.id, "planned");
  await featureService.changeStatus(db, SOLO_ACTOR, ws.id, feature.id, "in_progress");
  env = {
    db,
    wid: ws.id,
    projectId: project.id,
    featureId: feature.id,
  };
});

function makeReq(url: string, init: RequestInit = {}): Request {
  return new Request(`http://localhost${url}`, init);
}

function paramsOf(p: Record<string, string>): { params: Promise<Record<string, string>> } {
  return { params: Promise.resolve(p) };
}

async function jsonOf(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

async function createPendingCard(
  actionType: string,
  payload: Record<string, unknown>,
  options: { highRisk?: boolean; target?: Record<string, string> } = {},
): Promise<string> {
  const card = await actionCardService.create(env.db, SOLO_ACTOR, env.wid, "test-query", {
    type: actionType,
    title: `Test ${actionType}`,
    target: options.target ?? { project_id: env.projectId, feature_id: env.featureId },
    payload,
    reason: "test",
    risk: options.highRisk ? "test risk" : undefined,
    requires_confirmation: options.highRisk === true,
  } as never);
  return card.id;
}

// ---------------------------------------------------------------------------
// POST /ai-pm/query
// ---------------------------------------------------------------------------

describe("P05B POST /ai-pm/query", () => {
  it("returns 200 with answer + action cards in advisor mode", async () => {
    const res = await postQuery(
      makeReq(`/api/workspaces/${env.wid}/ai-pm/query`, {
        method: "POST",
        body: JSON.stringify({
          mode: "advisor",
          project_id: env.projectId,
          feature_id: env.featureId,
        }),
        headers: { "content-type": "application/json" },
      }),
      paramsOf({ wid: env.wid }),
    );
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.ok).toBe(true);
    const data = body.data as {
      query_id: string;
      answer: { mode: string; conclusion: string };
      action_cards: unknown[];
      provider_name: string;
    };
    expect(data.query_id).toBeTruthy();
    expect(data.answer.mode).toBe("advisor");
    expect(data.answer.conclusion.length).toBeGreaterThan(0);
    expect(data.provider_name).toBe("deterministic");
    expect(Array.isArray(data.action_cards)).toBe(true);
  });

  it("rejects an invalid mode with validation_error (400)", async () => {
    const res = await postQuery(
      makeReq(`/api/workspaces/${env.wid}/ai-pm/query`, {
        method: "POST",
        body: JSON.stringify({ mode: "invalid_mode" }),
        headers: { "content-type": "application/json" },
      }),
      paramsOf({ wid: env.wid }),
    );
    expect(res.status).toBe(400);
    const body = await jsonOf(res);
    expect(body.ok).toBe(false);
    expect(body.error_code).toBe("validation_error");
  });

  it("rejects a missing mode with validation_error (400)", async () => {
    const res = await postQuery(
      makeReq(`/api/workspaces/${env.wid}/ai-pm/query`, {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
      }),
      paramsOf({ wid: env.wid }),
    );
    expect(res.status).toBe(400);
    const body = await jsonOf(res);
    expect(body.error_code).toBe("validation_error");
  });
});

// ---------------------------------------------------------------------------
// POST /ai-pm/actions/:actionId/apply
// ---------------------------------------------------------------------------

describe("P05B POST /ai-pm/actions/:actionId/apply", () => {
  it("applies a create_work_item card → 200, work item created", async () => {
    const cardId = await createPendingCard(
      "create_work_item",
      { title: "E2E for P05B", type: "task", priority: "medium" },
    );
    const res = await postApply(
      makeReq(`/api/workspaces/${env.wid}/ai-pm/actions/${cardId}/apply`, {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
      }),
      paramsOf({ wid: env.wid, actionId: cardId }),
    );
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    const data = body.data as {
      action_id: string;
      status: string;
      result: { kind: string; workItemId: string };
    };
    expect(data.status).toBe("applied");
    expect(data.result.kind).toBe("create_work_item");
    expect(data.result.workItemId).toBeTruthy();
  });

  it("applies a mark_feature_done card when Done Gate blocks → 422 done_gate_blocked", async () => {
    // The feature has no evidence, no completed runs, no reviews → Done Gate blocks.
    const cardId = await createPendingCard(
      "mark_feature_done",
      { feature_id: env.featureId },
      { highRisk: true, target: { feature_id: env.featureId } },
    );
    const res = await postApply(
      makeReq(`/api/workspaces/${env.wid}/ai-pm/actions/${cardId}/apply`, {
        method: "POST",
        body: JSON.stringify({ confirm_high_risk: true }),
        headers: { "content-type": "application/json" },
      }),
      paramsOf({ wid: env.wid, actionId: cardId }),
    );
    expect(res.status).toBe(422);
    const body = await jsonOf(res);
    expect(body.ok).toBe(false);
    expect(body.error_code).toBe("done_gate_blocked");
  });

  it("applies a high-risk card without confirm_high_risk → 422 high_risk_confirmation_required", async () => {
    const cardId = await createPendingCard(
      "pause_project",
      { project_id: env.projectId, rationale: "Cost overrun" },
      { highRisk: true, target: {} },
    );
    const res = await postApply(
      makeReq(`/api/workspaces/${env.wid}/ai-pm/actions/${cardId}/apply`, {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
      }),
      paramsOf({ wid: env.wid, actionId: cardId }),
    );
    expect(res.status).toBe(422);
    const body = await jsonOf(res);
    expect(body.ok).toBe(false);
    expect(body.error_code).toBe("high_risk_confirmation_required");
  });

  it("returns 404 for a non-existent card", async () => {
    const res = await postApply(
      makeReq(`/api/workspaces/${env.wid}/ai-pm/actions/nonexistent/apply`, {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
      }),
      paramsOf({ wid: env.wid, actionId: "nonexistent" }),
    );
    expect(res.status).toBe(404);
    const body = await jsonOf(res);
    expect(body.error_code).toBe("not_found");
  });

  it("returns 409 when applying an already-applied card", async () => {
    const cardId = await createPendingCard(
      "create_work_item",
      { title: "Double apply", type: "task" },
    );
    // First apply succeeds.
    await postApply(
      makeReq(`/api/workspaces/${env.wid}/ai-pm/actions/${cardId}/apply`, {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
      }),
      paramsOf({ wid: env.wid, actionId: cardId }),
    );
    // Second apply → 409 conflict.
    const res = await postApply(
      makeReq(`/api/workspaces/${env.wid}/ai-pm/actions/${cardId}/apply`, {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
      }),
      paramsOf({ wid: env.wid, actionId: cardId }),
    );
    expect(res.status).toBe(409);
    const body = await jsonOf(res);
    expect(body.error_code).toBe("conflict");
  });
});

// ---------------------------------------------------------------------------
// POST /ai-pm/actions/:actionId/dismiss
// ---------------------------------------------------------------------------

describe("P05B POST /ai-pm/actions/:actionId/dismiss", () => {
  it("dismisses a normal card without a reason → 200", async () => {
    const cardId = await createPendingCard(
      "create_work_item",
      { title: "Dismiss me", type: "task" },
    );
    const res = await postDismiss(
      makeReq(`/api/workspaces/${env.wid}/ai-pm/actions/${cardId}/dismiss`, {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
      }),
      paramsOf({ wid: env.wid, actionId: cardId }),
    );
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    const data = body.data as { action_id: string; status: string };
    expect(data.status).toBe("dismissed");
  });

  it("rejects dismissing a high-risk card without a reason → 422", async () => {
    const cardId = await createPendingCard(
      "pause_project",
      { project_id: env.projectId, rationale: "x" },
      { highRisk: true, target: {} },
    );
    const res = await postDismiss(
      makeReq(`/api/workspaces/${env.wid}/ai-pm/actions/${cardId}/dismiss`, {
        method: "POST",
        body: JSON.stringify({}),
        headers: { "content-type": "application/json" },
      }),
      paramsOf({ wid: env.wid, actionId: cardId }),
    );
    expect(res.status).toBe(400);
    const body = await jsonOf(res);
    expect(body.error_code).toBe("validation_error");
  });

  it("dismisses a high-risk card with a reason → 200", async () => {
    const cardId = await createPendingCard(
      "pause_project",
      { project_id: env.projectId, rationale: "x" },
      { highRisk: true, target: {} },
    );
    const res = await postDismiss(
      makeReq(`/api/workspaces/${env.wid}/ai-pm/actions/${cardId}/dismiss`, {
        method: "POST",
        body: JSON.stringify({ reason: "Not needed anymore" }),
        headers: { "content-type": "application/json" },
      }),
      paramsOf({ wid: env.wid, actionId: cardId }),
    );
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    const data = body.data as { status: string };
    expect(data.status).toBe("dismissed");
  });
});

// ---------------------------------------------------------------------------
// POST + GET /weekly-reviews
// ---------------------------------------------------------------------------

describe("P05B /weekly-reviews", () => {
  it("saves a weekly review via POST → 200", async () => {
    const summary = JSON.stringify({ completed: 3, stalled: 1, open_risks: 0 });
    const res = await postWeeklyReview(
      makeReq(`/api/workspaces/${env.wid}/weekly-reviews`, {
        method: "POST",
        body: JSON.stringify({
          project_id: env.projectId,
          week_start: 1719792000000,
          week_end: 1720396800000,
          summary_json: summary,
        }),
        headers: { "content-type": "application/json" },
      }),
      paramsOf({ wid: env.wid }),
    );
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    const data = body.data as { review_id: string; review: { id: string } };
    expect(data.review_id).toBeTruthy();
    expect(data.review.id).toBe(data.review_id);
  });

  it("lists weekly reviews via GET", async () => {
    const res = await getWeeklyReviews(
      makeReq(`/api/workspaces/${env.wid}/weekly-reviews?project_id=${env.projectId}`),
      paramsOf({ wid: env.wid }),
    );
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    const data = body.data as { reviews: Array<{ id: string; projectId: string }> };
    expect(data.reviews.length).toBeGreaterThanOrEqual(1);
    expect(data.reviews[0]!.projectId).toBe(env.projectId);
  });

  it("rejects week_end < week_start with validation_error", async () => {
    const res = await postWeeklyReview(
      makeReq(`/api/workspaces/${env.wid}/weekly-reviews`, {
        method: "POST",
        body: JSON.stringify({
          project_id: env.projectId,
          week_start: 200,
          week_end: 100,
          summary_json: "{}",
        }),
        headers: { "content-type": "application/json" },
      }),
      paramsOf({ wid: env.wid }),
    );
    expect(res.status).toBe(400);
    const body = await jsonOf(res);
    expect(body.error_code).toBe("validation_error");
  });
});

// ---------------------------------------------------------------------------
// POST /decisions
// ---------------------------------------------------------------------------

describe("P05B POST /decisions", () => {
  it("records a decision → 200", async () => {
    const res = await postDecision(
      makeReq(`/api/workspaces/${env.wid}/decisions`, {
        method: "POST",
        body: JSON.stringify({
          project_id: env.projectId,
          decision_text: "We will pause Phase 6 until Q3.",
          rationale: "Cost overrun in Q2.",
        }),
        headers: { "content-type": "application/json" },
      }),
      paramsOf({ wid: env.wid }),
    );
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    const data = body.data as {
      decision_id: string;
      decision: { id: string; decisionText: string; source: string };
    };
    expect(data.decision_id).toBeTruthy();
    expect(data.decision.source).toBe("user");
  });

  it("rejects an empty decision_text with validation_error", async () => {
    const res = await postDecision(
      makeReq(`/api/workspaces/${env.wid}/decisions`, {
        method: "POST",
        body: JSON.stringify({
          project_id: env.projectId,
          decision_text: "",
        }),
        headers: { "content-type": "application/json" },
      }),
      paramsOf({ wid: env.wid }),
    );
    expect(res.status).toBe(400);
    const body = await jsonOf(res);
    expect(body.error_code).toBe("validation_error");
  });
});

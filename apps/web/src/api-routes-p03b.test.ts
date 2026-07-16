/**
 * P03B API integration tests — review + finding + done-gate routes.
 *
 * Exercises the Next.js route handlers directly with constructed Request
 * objects against an in-memory DB. Verifies the envelope, status codes, and
 * the domain service wiring.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { setDbClient, createInMemoryDb } from "@statehub/db/node";
import {
  SOLO_ACTOR,
  workspaceService,
  projectService,
  featureService,
  reviewService,
} from "@statehub/domain";
import type { DbClient } from "@statehub/db";

// Route handlers — each exports GET / POST / PATCH.
import { GET as listReviews } from "../app/api/workspaces/[wid]/projects/[pid]/reviews/route";
import { GET as getReview } from "../app/api/workspaces/[wid]/projects/[pid]/reviews/[rid]/route";
import { PATCH as patchFinding } from "../app/api/workspaces/[wid]/projects/[pid]/reviews/[rid]/findings/[fid]/route";
import { POST as dismissFinding } from "../app/api/workspaces/[wid]/projects/[pid]/reviews/[rid]/findings/[fid]/dismiss/route";
import { GET as getDoneGate } from "../app/api/workspaces/[wid]/projects/[pid]/features/[fid]/done-gate/route";

interface Env {
  db: DbClient;
  wid: string;
  pid: string;
  featureId: string;
  reviewId: string;
  findingId: string;
}

let env: Env;

beforeAll(async () => {
  const db = createInMemoryDb();
  setDbClient(db);
  const ws = await workspaceService.create(db, SOLO_ACTOR, {
    slug: "p03b-api-ws",
    name: "P03B API",
  });
  const project = await projectService.create(db, SOLO_ACTOR, ws.id, {
    slug: "proj",
    name: "P",
    identifier: "PBA",
  });
  const feature = await featureService.create(db, SOLO_ACTOR, ws.id, project.id, {
    name: "P03B API Feat",
    status: "in_progress",
  });
  const reviewResult = await reviewService.submit(db, SOLO_ACTOR, ws.id, {
    projectId: project.id,
    featureId: feature.id,
    reviewer: "codex",
    verdict: "needs_changes",
    findings: [
      { severity: "high", title: "High finding" },
      { severity: "low", title: "Low finding" },
    ],
  });
  env = {
    db,
    wid: ws.id,
    pid: project.id,
    featureId: feature.id,
    reviewId: reviewResult.review.id,
    findingId: reviewResult.findings[0]!.id,
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

describe("P03B API GET /reviews", () => {
  it("lists reviews in a project", async () => {
    const res = await listReviews(
      makeReq(`/api/workspaces/${env.wid}/projects/${env.pid}/reviews`),
      paramsOf({ wid: env.wid, pid: env.pid }),
    );
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    expect(body.ok).toBe(true);
    const data = body.data as unknown[];
    expect(data.length).toBeGreaterThanOrEqual(1);
  });

  it("filters by feature_id", async () => {
    const res = await listReviews(
      makeReq(`/api/workspaces/${env.wid}/projects/${env.pid}/reviews?feature_id=${env.featureId}`),
      paramsOf({ wid: env.wid, pid: env.pid }),
    );
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    const data = body.data as Array<{ featureId: string }>;
    expect(data.every((r) => r.featureId === env.featureId)).toBe(true);
  });
});

describe("P03B API GET /reviews/:rid", () => {
  it("returns review + findings", async () => {
    const res = await getReview(
      makeReq(`/api/workspaces/${env.wid}/projects/${env.pid}/reviews/${env.reviewId}`),
      paramsOf({ wid: env.wid, rid: env.reviewId }),
    );
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    const data = body.data as { review: { id: string }; findings: unknown[] };
    expect(data.review.id).toBe(env.reviewId);
    expect(data.findings).toHaveLength(2);
  });

  it("returns 404 for unknown review", async () => {
    const res = await getReview(
      makeReq(`/api/workspaces/${env.wid}/projects/${env.pid}/reviews/nonexistent`),
      paramsOf({ wid: env.wid, rid: "nonexistent" }),
    );
    expect(res.status).toBe(404);
    const body = await jsonOf(res);
    expect(body.ok).toBe(false);
    expect(body.error_code).toBe("not_found");
  });
});

describe("P03B API PATCH /findings/:fid", () => {
  it("transitions a finding open → accepted", async () => {
    const res = await patchFinding(
      makeReq(
        `/api/workspaces/${env.wid}/projects/${env.pid}/reviews/${env.reviewId}/findings/${env.findingId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ to_status: "accepted" }),
          headers: { "content-type": "application/json" },
        },
      ),
      paramsOf({ wid: env.wid, fid: env.findingId }),
    );
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    const data = body.data as { status: string };
    expect(data.status).toBe("accepted");
  });

  it("rejects invalid transition with validation_error", async () => {
    // finding is now 'accepted' — accepted→accepted is invalid.
    const res = await patchFinding(
      makeReq(
        `/api/workspaces/${env.wid}/projects/${env.pid}/reviews/${env.reviewId}/findings/${env.findingId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ to_status: "accepted" }),
          headers: { "content-type": "application/json" },
        },
      ),
      paramsOf({ wid: env.wid, fid: env.findingId }),
    );
    expect(res.status).toBe(400);
    const body = await jsonOf(res);
    expect(body.ok).toBe(false);
    expect(body.error_code).toBe("validation_error");
  });
});

describe("P03B API POST /findings/:fid/dismiss", () => {
  it("rejects empty reason with validation_error", async () => {
    // Use the low finding (still open) for dismiss.
    const findings = await reviewService.listFindings(env.db, env.wid, env.reviewId);
    const lowFinding = findings.find((f) => f.severity === "low")!;
    const res = await dismissFinding(
      makeReq(
        `/api/workspaces/${env.wid}/projects/${env.pid}/reviews/${env.reviewId}/findings/${lowFinding.id}/dismiss`,
        {
          method: "POST",
          body: JSON.stringify({ reason: "" }),
          headers: { "content-type": "application/json" },
        },
      ),
      paramsOf({ wid: env.wid, fid: lowFinding.id }),
    );
    expect(res.status).toBe(400);
    const body = await jsonOf(res);
    expect(body.error_code).toBe("validation_error");
  });

  it("dismisses with a reason", async () => {
    const findings = await reviewService.listFindings(env.db, env.wid, env.reviewId);
    const lowFinding = findings.find((f) => f.severity === "low")!;
    const res = await dismissFinding(
      makeReq(
        `/api/workspaces/${env.wid}/projects/${env.pid}/reviews/${env.reviewId}/findings/${lowFinding.id}/dismiss`,
        {
          method: "POST",
          body: JSON.stringify({ reason: "not actionable" }),
          headers: { "content-type": "application/json" },
        },
      ),
      paramsOf({ wid: env.wid, fid: lowFinding.id }),
    );
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    const data = body.data as { status: string; dismissedReason: string };
    expect(data.status).toBe("dismissed");
    expect(data.dismissedReason).toBe("not actionable");
  });
});

describe("P03B API GET /features/:fid/done-gate", () => {
  it("returns v1 summary with checklist + result", async () => {
    const res = await getDoneGate(
      makeReq(`/api/workspaces/${env.wid}/projects/${env.pid}/features/${env.featureId}/done-gate`),
      paramsOf({ wid: env.wid, fid: env.featureId }),
    );
    expect(res.status).toBe(200);
    const body = await jsonOf(res);
    const data = body.data as {
      result: string;
      checklist: Array<{ code: string; status: string }>;
      openBlockerHighCount: number;
      latestReview: { id: string } | null;
    };
    expect(["pass", "warn", "blocked"]).toContain(data.result);
    expect(data.checklist.length).toBeGreaterThan(0);
    expect(data.latestReview?.id).toBe(env.reviewId);
    // The high finding was transitioned to accepted (not fixed), so it still
    // counts as open blocker/high — Done Gate should be blocked.
    expect(data.openBlockerHighCount).toBeGreaterThanOrEqual(1);
    expect(data.result).toBe("blocked");
  });
});

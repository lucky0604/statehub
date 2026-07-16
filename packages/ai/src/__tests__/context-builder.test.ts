/**
 * Context builder + DeterministicProvider tests.
 */
import { describe, it, expect } from "vitest";
import { buildContextPacket } from "../context-builder";
import { DeterministicProvider } from "../provider";
import { parseAIAnswer } from "../answer-schema";
import type { Project, Feature, WorkItem, ReviewFinding } from "@statehub/db";

describe("buildContextPacket", () => {
  it("emits missing-data warnings for an empty workspace", () => {
    const packet = buildContextPacket({
      mode: "advisor",
      workspace: { id: "ws", slug: "ws", name: "WS" },
      currentProject: null,
      currentFeature: null,
      projects: [],
      features: [],
      workItems: [],
      openFindings: [],
      recentReviews: [],
      recentAgentRuns: [],
      recentEvidence: [],
      openTodos: [],
      cycles: [],
    });
    expect(packet.missing_data_warnings).toContain("workspace has no projects");
    expect(packet.missing_data_warnings).toContain("workspace has no features");
    expect(packet.missing_data_warnings).toContain("workspace has no work items");
    expect(packet.missing_data_warnings).toContain(
      "no evidence recorded yet — trust state cannot be derived",
    );
  });

  it("emits a missing-data warning when review_triage has no findings", () => {
    const packet = buildContextPacket({
      mode: "review_triage",
      workspace: { id: "ws", slug: "ws", name: "WS" },
      currentProject: null,
      currentFeature: null,
      projects: [{ id: "p", slug: "p", name: "P", status: "active", portfolioPriority: "P1" }],
      features: [],
      workItems: [],
      openFindings: [],
      recentReviews: [],
      recentAgentRuns: [],
      recentEvidence: [],
      openTodos: [],
      cycles: [],
    });
    expect(packet.missing_data_warnings).toContain(
      "no open review findings to triage",
    );
  });

  it("reorders features so current_feature comes first", () => {
    const f1 = { id: "f1", name: "F1", status: "in_progress", projectId: "p", createdAt: 1, updatedAt: 1 } as Pick<Feature, "id" | "name" | "status" | "projectId" | "createdAt" | "updatedAt">;
    const f2 = { id: "f2", name: "F2", status: "planned", projectId: "p", createdAt: 2, updatedAt: 2 } as Pick<Feature, "id" | "name" | "status" | "projectId" | "createdAt" | "updatedAt">;
    const packet = buildContextPacket({
      mode: "advisor",
      workspace: { id: "ws", slug: "ws", name: "WS" },
      currentProject: null,
      currentFeature: { id: "f2", name: "F2", status: "planned", projectId: "p", createdAt: 2, updatedAt: 2 } as Feature,
      projects: [],
      features: [f1, f2],
      workItems: [],
      openFindings: [],
      recentReviews: [],
      recentAgentRuns: [],
      recentEvidence: [],
      openTodos: [],
      cycles: [],
    });
    expect(packet.features[0]!.id).toBe("f2");
    expect(packet.features[1]!.id).toBe("f1");
  });
});

describe("DeterministicProvider", () => {
  const provider = new DeterministicProvider();

  it("produces a parseable answer envelope in advisor mode", async () => {
    const packet = buildContextPacket({
      mode: "advisor",
      workspace: { id: "ws", slug: "ws", name: "WS" },
      currentProject: { id: "p", slug: "p", name: "P" } as Project,
      currentFeature: { id: "f", name: "F", status: "in_progress", projectId: "p", createdAt: 1, updatedAt: 1 } as Feature,
      projects: [{ id: "p", slug: "p", name: "P", status: "active", portfolioPriority: "P1" }],
      features: [{ id: "f", name: "F", status: "in_progress", projectId: "p", createdAt: 1, updatedAt: 1 }],
      workItems: [
        { id: "w1", title: "W1", type: "task", priority: "high", stateId: "s", featureId: "f", projectId: "p", sequenceId: 1, projectIdentifier: "P-1" },
      ] as Pick<WorkItem, "id" | "title" | "type" | "priority" | "stateId" | "featureId" | "projectId" | "sequenceId" | "projectIdentifier">[],
      openFindings: [
        { id: "fi1", severity: "high", title: "Bug", reviewId: "r1", status: "open" } as Pick<ReviewFinding, "id" | "severity" | "title" | "reviewId" | "status">,
      ],
      recentReviews: [],
      recentAgentRuns: [],
      recentEvidence: [{ id: "e1", evidenceType: "test_result", title: "T", trustState: "trusted", stalenessState: "fresh", createdAt: 1 }] as never,
      openTodos: [],
      cycles: [],
    });
    const res = await provider.complete({ mode: "advisor", context: packet });
    expect(res.providerName).toBe("deterministic");
    const answer = parseAIAnswer(res.text);
    expect(answer.mode).toBe("advisor");
    expect(answer.conclusion.length).toBeGreaterThan(0);
    expect(answer.basis.length).toBeGreaterThan(0);
  });

  it("produces a parseable answer envelope in plan mode", async () => {
    const packet = buildContextPacket({
      mode: "plan",
      workspace: { id: "ws", slug: "ws", name: "WS" },
      currentProject: { id: "p", slug: "p", name: "P" } as Project,
      currentFeature: { id: "f", name: "F", status: "in_progress", projectId: "p", createdAt: 1, updatedAt: 1 } as Feature,
      projects: [{ id: "p", slug: "p", name: "P", status: "active", portfolioPriority: "P1" }],
      features: [{ id: "f", name: "F", status: "in_progress", projectId: "p", createdAt: 1, updatedAt: 1 }],
      workItems: [
        { id: "w1", title: "W1", type: "task", priority: "medium", stateId: "s", featureId: "f", projectId: "p", sequenceId: 1, projectIdentifier: "P-1" },
      ] as Pick<WorkItem, "id" | "title" | "type" | "priority" | "stateId" | "featureId" | "projectId" | "sequenceId" | "projectIdentifier">[],
      openFindings: [],
      recentReviews: [],
      recentAgentRuns: [],
      recentEvidence: [],
      openTodos: [],
      cycles: [],
    });
    const res = await provider.complete({ mode: "plan", context: packet });
    const answer = parseAIAnswer(res.text);
    expect(answer.mode).toBe("plan");
    // Plan mode with few work items should propose creating more.
    expect(answer.suggested_actions.length).toBeGreaterThan(0);
    expect(answer.suggested_actions[0]!.type).toBe("create_work_item");
  });

  it("produces a parseable answer envelope in weekly_review mode", async () => {
    const packet = buildContextPacket({
      mode: "weekly_review",
      workspace: { id: "ws", slug: "ws", name: "WS" },
      currentProject: { id: "p", slug: "p", name: "P" } as Project,
      currentFeature: null,
      projects: [{ id: "p", slug: "p", name: "P", status: "active", portfolioPriority: "P1" }],
      features: [],
      workItems: [],
      openFindings: [],
      recentReviews: [],
      recentAgentRuns: [],
      recentEvidence: [],
      openTodos: [],
      cycles: [],
    });
    const res = await provider.complete({ mode: "weekly_review", context: packet });
    const answer = parseAIAnswer(res.text);
    expect(answer.mode).toBe("weekly_review");
    // Weekly review mode should propose saving a review.
    expect(answer.suggested_actions.some((a) => a.type === "save_weekly_review")).toBe(true);
  });

  it("is deterministic — same input produces the same output", async () => {
    const packet = buildContextPacket({
      mode: "advisor",
      workspace: { id: "ws", slug: "ws", name: "WS" },
      currentProject: null,
      currentFeature: null,
      projects: [],
      features: [],
      workItems: [],
      openFindings: [],
      recentReviews: [],
      recentAgentRuns: [],
      recentEvidence: [],
      openTodos: [],
      cycles: [],
    });
    const r1 = await provider.complete({ mode: "advisor", context: packet });
    const r2 = await provider.complete({ mode: "advisor", context: packet });
    expect(r1.text).toBe(r2.text);
  });
});

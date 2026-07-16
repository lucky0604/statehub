/**
 * Action schema tests — zod validation for all 13 action card types.
 */
import { describe, it, expect } from "vitest";
import {
  actionCardEnvelopeSchema,
  validateActionCardEnvelope,
  validateActionPayload,
  isHighRiskActionType,
  NORMAL_ACTION_TYPES,
  HIGH_RISK_ACTION_TYPES,
  ACTION_TYPES,
} from "../action-schema";
import { parseAIAnswer } from "../answer-schema";

describe("action schema: type taxonomy", () => {
  it("has 8 normal + 5 high-risk = 13 total action types", () => {
    expect(NORMAL_ACTION_TYPES).toHaveLength(8);
    expect(HIGH_RISK_ACTION_TYPES).toHaveLength(5);
    expect(ACTION_TYPES).toHaveLength(13);
  });

  it("isHighRiskActionType returns true only for high-risk types", () => {
    expect(isHighRiskActionType("pause_project")).toBe(true);
    expect(isHighRiskActionType("mark_feature_done")).toBe(true);
    expect(isHighRiskActionType("archive_project")).toBe(true);
    expect(isHighRiskActionType("dismiss_high_finding")).toBe(true);
    expect(isHighRiskActionType("change_portfolio_priority")).toBe(true);
    expect(isHighRiskActionType("create_work_item")).toBe(false);
    expect(isHighRiskActionType("record_decision")).toBe(false);
  });
});

describe("action schema: create_work_item", () => {
  it("accepts a well-formed payload", () => {
    const envelope = {
      type: "create_work_item",
      title: "Add input validation",
      target: { project_id: "proj-1", feature_id: "feat-1" },
      payload: {
        title: "Validate payload before insert",
        type: "task",
        priority: "high",
      },
      reason: "High finding on the feature",
      requires_confirmation: false,
    };
    const parsed = validateActionCardEnvelope(envelope);
    expect(parsed.type).toBe("create_work_item");
    if (parsed.type === "create_work_item") {
      expect(parsed.payload.type).toBe("task");
    }
  });

  it("rejects an invalid work item type", () => {
    const envelope = {
      type: "create_work_item",
      title: "x",
      target: { project_id: "p" },
      payload: { title: "x", type: "INVALID_TYPE" },
      reason: "x",
      requires_confirmation: false,
    };
    expect(() => validateActionCardEnvelope(envelope)).toThrow();
  });

  it("rejects a missing title", () => {
    const envelope = {
      type: "create_work_item",
      title: "x",
      target: { project_id: "p" },
      payload: { type: "task" },
      reason: "x",
      requires_confirmation: false,
    };
    expect(() => validateActionCardEnvelope(envelope)).toThrow();
  });
});

describe("action schema: high-risk requires_confirmation", () => {
  it("rejects a high-risk action with requires_confirmation=false", () => {
    const envelope = {
      type: "pause_project",
      title: "Pause project",
      target: {},
      payload: { project_id: "p", rationale: "cost" },
      reason: "Cost overrun",
      risk: "May delay release",
      requires_confirmation: false,
    };
    expect(() => validateActionCardEnvelope(envelope)).toThrow();
  });

  it("accepts a high-risk action with requires_confirmation=true", () => {
    const envelope = {
      type: "pause_project",
      title: "Pause project",
      target: {},
      payload: { project_id: "p", rationale: "cost" },
      reason: "Cost overrun",
      risk: "May delay release",
      requires_confirmation: true,
    };
    const parsed = validateActionCardEnvelope(envelope);
    expect(parsed.requires_confirmation).toBe(true);
  });

  it("rejects a high-risk action missing rationale", () => {
    const envelope = {
      type: "pause_project",
      title: "x",
      target: {},
      payload: { project_id: "p" },
      reason: "x",
      risk: "x",
      requires_confirmation: true,
    };
    expect(() => validateActionCardEnvelope(envelope)).toThrow();
  });
});

describe("action schema: set_current_focus needs feature_id or work_item_id", () => {
  it("rejects a payload with neither", () => {
    const envelope = {
      type: "set_current_focus",
      title: "x",
      target: {},
      payload: {},
      reason: "x",
      requires_confirmation: false,
    };
    expect(() => validateActionCardEnvelope(envelope)).toThrow();
  });

  it("accepts a payload with feature_id", () => {
    const envelope = {
      type: "set_current_focus",
      title: "x",
      target: {},
      payload: { feature_id: "feat-1" },
      reason: "x",
      requires_confirmation: false,
    };
    expect(validateActionCardEnvelope(envelope).type).toBe("set_current_focus");
  });
});

describe("action schema: validateActionPayload by type", () => {
  it("re-validates a stored payload", () => {
    const payload = { decision_text: "We will pause.", rationale: "Cost." };
    const result = validateActionPayload("record_decision", payload);
    expect(result).toEqual(payload);
  });

  it("rejects a malformed payload", () => {
    expect(() =>
      validateActionPayload("record_decision", { decision_text: "" }),
    ).toThrow();
  });

  it("throws on unknown action type", () => {
    expect(() =>
      validateActionPayload("unknown_type" as never, {}),
    ).toThrow();
  });
});

describe("answer schema: parseAIAnswer", () => {
  it("parses a well-formed answer envelope", () => {
    const raw = JSON.stringify({
      mode: "advisor",
      conclusion: "Feature is on track.",
      basis: [{ entity: "feature:feat-1", fact: "status=in_progress" }],
      risks: ["No trusted evidence yet"],
      missing_data: [],
      suggested_actions: [
        {
          type: "create_work_item",
          title: "Add tests",
          target: { feature_id: "feat-1" },
          payload: { title: "Write e2e", type: "task" },
          reason: "Coverage is low",
          requires_confirmation: false,
        },
      ],
    });
    const parsed = parseAIAnswer(raw);
    expect(parsed.mode).toBe("advisor");
    expect(parsed.suggested_actions).toHaveLength(1);
    expect(parsed.suggested_actions[0]!.type).toBe("create_work_item");
  });

  it("rejects malformed JSON", () => {
    expect(() => parseAIAnswer("not json")).toThrow();
  });

  it("rejects an answer with an invalid action card", () => {
    const raw = JSON.stringify({
      mode: "advisor",
      conclusion: "x",
      basis: [],
      risks: [],
      missing_data: [],
      suggested_actions: [
        {
          type: "create_work_item",
          // missing payload.title
          target: {},
          payload: { type: "task" },
          reason: "x",
          requires_confirmation: false,
        },
      ],
    });
    expect(() => parseAIAnswer(raw)).toThrow();
  });

  it("rejects an answer with extra fields (strict)", () => {
    const raw = JSON.stringify({
      mode: "advisor",
      conclusion: "x",
      basis: [],
      risks: [],
      missing_data: [],
      suggested_actions: [],
      extra_field: "should be rejected",
    });
    expect(() => parseAIAnswer(raw)).toThrow();
  });
});

describe("action schema: discriminated union", () => {
  it("actionCardEnvelopeSchema.parse handles each type", () => {
    for (const type of ACTION_TYPES) {
      // Build a minimal valid envelope per type. This catches typos in the
      // discriminated union setup.
      const sample = buildSampleEnvelope(type);
      const parsed = actionCardEnvelopeSchema.parse(sample);
      expect(parsed.type).toBe(type);
    }
  });
});

function buildSampleEnvelope(type: string): unknown {
  const base = { title: "t", reason: "r", risk: "rs" };
  const target = {};
  switch (type) {
    case "create_feature":
      return { ...base, type, target, payload: { name: "n" }, requires_confirmation: false };
    case "create_work_item":
      return { ...base, type, target, payload: { title: "t", type: "task" }, requires_confirmation: false };
    case "update_work_item_priority":
      return { ...base, type, target, payload: { work_item_id: "w", priority: "high" }, requires_confirmation: false };
    case "set_current_focus":
      return { ...base, type, target, payload: { feature_id: "f" }, requires_confirmation: false };
    case "record_decision":
      return { ...base, type, target, payload: { decision_text: "d" }, requires_confirmation: false };
    case "create_review_fix_items":
      return { ...base, type, target, payload: { review_id: "rev" }, requires_confirmation: false };
    case "save_weekly_review":
      return { ...base, type, target, payload: { week_start: 1, week_end: 2, summary_json: "{}" }, requires_confirmation: false };
    case "generate_agent_prompt":
      return { ...base, type, target, payload: { agent: "opencode", prompt_kind: "implement" }, requires_confirmation: false };
    case "pause_project":
      return { ...base, type, target, payload: { project_id: "p", rationale: "r" }, requires_confirmation: true };
    case "archive_project":
      return { ...base, type, target, payload: { project_id: "p", rationale: "r" }, requires_confirmation: true };
    case "dismiss_high_finding":
      return { ...base, type, target, payload: { finding_id: "f", reason: "r" }, requires_confirmation: true };
    case "mark_feature_done":
      return { ...base, type, target, payload: { feature_id: "f" }, requires_confirmation: true };
    case "change_portfolio_priority":
      return { ...base, type, target, payload: { project_id: "p", priority: "P0" }, requires_confirmation: true };
    default:
      throw new Error(`unknown type ${type}`);
  }
}

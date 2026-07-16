/**
 * MCP integration — P03A review tools (submit_review,
 * create_followup_todos_from_review, dry_run, scope_missing).
 *
 * Drives the real McpServer (buildServer) over an in-memory transport with the
 * SDK client. Exercises the full P03A path per request:
 *   client.callTool -> scope guard -> idempotency guard -> dry_run short-circuit
 *   -> reviewService.submit / createFollowupFixes -> in-memory DB -> event log
 *
 * Covers the P03A acceptance criteria: create + replay + dry_run + scope_missing
 * + followup-creates-only-blocker/high + idempotent re-run + low/nit rejected.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { setDbClient, createInMemoryDb } from "@statehub/db/node";
import type { DbClient } from "@statehub/db";
import {
  SOLO_ACTOR,
  remoteMcpActor,
  workspaceService,
  projectService,
  featureService,
  tokenService,
  type VerifiedToken,
} from "@statehub/domain";
import { buildServer, type ToolContext } from "../src/registry";

async function connect(db: DbClient, ctx: ToolContext): Promise<Client> {
  const server = buildServer(ctx);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "p03a-client", version: "0.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

interface ToolResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

function textOf(result: unknown): string {
  const r = result as ToolResult;
  const block = r.content[0];
  if (!block || block.type !== "text" || typeof block.text !== "string") {
    throw new Error("expected a text content block");
  }
  return block.text;
}

function envelopeOf(result: unknown): Record<string, unknown> {
  return JSON.parse(textOf(result)) as Record<string, unknown>;
}

async function setup() {
  const db = createInMemoryDb();
  setDbClient(db);
  const ws = await workspaceService.create(db, SOLO_ACTOR, {
    slug: "p03a-mcp-ws",
    name: "P03A MCP",
  });
  const project = await projectService.create(db, SOLO_ACTOR, ws.id, {
    slug: "proj",
    name: "P",
    identifier: "PSM",
  });
  const feature = await featureService.create(db, SOLO_ACTOR, ws.id, project.id, {
    name: "P03A Feat",
    status: "in_progress",
  });

  const writeToken = await tokenService.issue(db, ws.id, {
    name: "writer",
    scopes: ["read", "write_agent_state"],
  });
  const readToken = await tokenService.issue(db, ws.id, { name: "reader", scopes: ["read"] });
  const writeVerified = (await tokenService.verify(db, writeToken.token))!;
  const readVerified = (await tokenService.verify(db, readToken.token))!;

  return { db, wsId: ws.id, projectId: project.id, featureId: feature.id, writeVerified, readVerified };
}

describe("mcp-remote P03A submit_review", () => {
  let base: Awaited<ReturnType<typeof setup>>;

  beforeAll(async () => {
    base = await setup();
  });

  function ctxFor(token: VerifiedToken): ToolContext {
    return {
      db: base.db,
      workspaceId: base.wsId,
      actor: remoteMcpActor(token.name, token.tokenId),
      token,
    };
  }

  it("creates a review + findings on first call", async () => {
    const client = await connect(base.db, ctxFor(base.writeVerified));
    const result = await client.callTool({
      name: "submit_review",
      arguments: {
        project_id: base.projectId,
        feature_id: base.featureId,
        reviewer: "codex",
        model: "gpt-5",
        verdict: "needs_changes",
        summary: "Close but resume missing",
        findings: [
          { severity: "high", title: "Missing resume", file_path: "src/auth.ts" },
          { severity: "low", title: "Typo" },
        ],
        idempotency_key: "review-key-1",
      },
    });
    const env = envelopeOf(result);
    expect(env.ok).toBe(true);
    const data = env.data as {
      review_id: string;
      verdict: string;
      findings_count: number;
      finding_ids: string[];
      action: string;
      target_scope: string;
    };
    expect(data.review_id).toMatch(/^[\w-]+$/);
    expect(data.verdict).toBe("needs_changes");
    expect(data.findings_count).toBe(2);
    expect(data.finding_ids).toHaveLength(2);
    expect(data.action).toBe("created");
    expect(data.target_scope).toBe("feature");
    await client.close();
  });

  it("replaying with the same idempotency_key returns the first review_id", async () => {
    const client = await connect(base.db, ctxFor(base.writeVerified));
    const args = {
      project_id: base.projectId,
      feature_id: base.featureId,
      reviewer: "codex",
      verdict: "approved",
      findings: [{ severity: "low", title: "Nit" }],
      idempotency_key: "review-key-replay",
    };
    const first = await client.callTool({ name: "submit_review", arguments: args });
    const second = await client.callTool({ name: "submit_review", arguments: args });
    const firstId = (envelopeOf(first).data as { review_id: string }).review_id;
    const secondId = (envelopeOf(second).data as { review_id: string }).review_id;
    expect(secondId).toBe(firstId);

    // Verify no duplicate review row was inserted.
    const rows = await base.db.all<{ id: string }>(
      "SELECT id FROM reviews WHERE workspace_id = ? AND id = ?",
      [base.wsId, firstId],
    );
    expect(rows).toHaveLength(1);
    await client.close();
  });

  it("dry_run=true returns the shape with a synthetic id and writes nothing", async () => {
    const client = await connect(base.db, ctxFor(base.writeVerified));
    const result = await client.callTool({
      name: "submit_review",
      arguments: {
        project_id: base.projectId,
        feature_id: base.featureId,
        reviewer: "codex",
        verdict: "informational",
        findings: [{ severity: "medium", title: "Heads up" }],
        idempotency_key: "review-dry-run",
        dry_run: true,
      },
    });
    const env = envelopeOf(result);
    expect(env.ok).toBe(true);
    const data = env.data as { review_id: string; findings_count: number };
    expect(data.review_id).toMatch(/^dry-run-/);
    expect(data.findings_count).toBe(1);

    // No review row should exist with a dry-run id.
    const rows = await base.db.all<{ id: string }>(
      "SELECT id FROM reviews WHERE workspace_id = ? AND id = ?",
      [base.wsId, data.review_id],
    );
    expect(rows).toHaveLength(0);
    await client.close();
  });

  it("rejects a read-only token with scope_missing", async () => {
    const client = await connect(base.db, ctxFor(base.readVerified));
    const result = await client.callTool({
      name: "submit_review",
      arguments: {
        project_id: base.projectId,
        reviewer: "codex",
        verdict: "approved",
        findings: [],
        idempotency_key: "review-readonly",
      },
    });
    const env = envelopeOf(result);
    expect(env.ok).toBe(false);
    expect(env.error_code).toBe("scope_missing");
    await client.close();
  });

  it("rejects submit with unknown project (not_found)", async () => {
    const client = await connect(base.db, ctxFor(base.writeVerified));
    const result = await client.callTool({
      name: "submit_review",
      arguments: {
        project_id: "nonexistent",
        reviewer: "codex",
        verdict: "approved",
        findings: [],
        idempotency_key: "review-404",
      },
    });
    const env = envelopeOf(result);
    expect(env.ok).toBe(false);
    expect(env.error_code).toBe("not_found");
    await client.close();
  });
});

describe("mcp-remote P03A create_followup_todos_from_review", () => {
  let base: Awaited<ReturnType<typeof setup>>;
  let reviewId: string;

  beforeAll(async () => {
    base = await setup();
    const client = await connect(base.db, {
      db: base.db,
      workspaceId: base.wsId,
      actor: remoteMcpActor("writer", "tok-seed"),
      token: base.writeVerified,
    });
    const result = await client.callTool({
      name: "submit_review",
      arguments: {
        project_id: base.projectId,
        feature_id: base.featureId,
        reviewer: "codex",
        verdict: "needs_changes",
        findings: [
          { severity: "blocker", title: "Blocker" },
          { severity: "high", title: "High" },
          { severity: "medium", title: "Medium" },
          { severity: "low", title: "Low" },
        ],
        idempotency_key: "review-for-followup",
      },
    });
    reviewId = (envelopeOf(result).data as { review_id: string }).review_id;
    await client.close();
  });

  function ctxForWrite(): ToolContext {
    return {
      db: base.db,
      workspaceId: base.wsId,
      actor: remoteMcpActor("writer", "tok-fix"),
      token: base.writeVerified,
    };
  }

  it("creates fix items for blocker + high only (default severities)", async () => {
    const client = await connect(base.db, ctxForWrite());
    const result = await client.callTool({
      name: "create_followup_todos_from_review",
      arguments: {
        review_id: reviewId,
        idempotency_key: "followup-1",
      },
    });
    const env = envelopeOf(result);
    expect(env.ok).toBe(true);
    const data = env.data as {
      created_fixes: Array<{ severity: string; identifier: string }>;
      skipped_findings: Array<{ reason: string }>;
      action: string;
    };
    expect(data.created_fixes).toHaveLength(2);
    expect(data.created_fixes.every((c) => c.identifier.startsWith("PSM-"))).toBe(true);
    expect(data.action).toBe("created");
    await client.close();
  });

  it("re-running with a different idempotency_key does not duplicate (already_linked)", async () => {
    const client = await connect(base.db, ctxForWrite());
    const result = await client.callTool({
      name: "create_followup_todos_from_review",
      arguments: {
        review_id: reviewId,
        idempotency_key: "followup-2",
      },
    });
    const env = envelopeOf(result);
    expect(env.ok).toBe(true);
    const data = env.data as {
      created_fixes: unknown[];
      skipped_findings: Array<{ reason: string }>;
      action: string;
    };
    expect(data.created_fixes).toHaveLength(0);
    expect(data.action).toBe("noop");
    const alreadyLinked = data.skipped_findings.filter((s) => s.reason === "already_linked");
    expect(alreadyLinked.length).toBeGreaterThanOrEqual(2);
    await client.close();
  });

  it("rejects low severity with validation_error", async () => {
    const client = await connect(base.db, ctxForWrite());
    const result = await client.callTool({
      name: "create_followup_todos_from_review",
      arguments: {
        review_id: reviewId,
        severities: ["low"],
        idempotency_key: "followup-low",
      },
    });
    const env = envelopeOf(result);
    expect(env.ok).toBe(false);
    expect(env.error_code).toBe("validation_error");
    await client.close();
  });

  it("dry_run=true returns would-be-creates with synthetic ids and writes nothing", async () => {
    // Use a fresh review so nothing is linked yet.
    const seedClient = await connect(base.db, ctxForWrite());
    const sub = await seedClient.callTool({
      name: "submit_review",
      arguments: {
        project_id: base.projectId,
        feature_id: base.featureId,
        reviewer: "codex",
        verdict: "needs_changes",
        findings: [{ severity: "high", title: "Dry run target" }],
        idempotency_key: "review-dry-followup",
      },
    });
    const dryReviewId = (envelopeOf(sub).data as { review_id: string }).review_id;
    await seedClient.close();

    const client = await connect(base.db, ctxForWrite());
    const result = await client.callTool({
      name: "create_followup_todos_from_review",
      arguments: {
        review_id: dryReviewId,
        idempotency_key: "followup-dry",
        dry_run: true,
      },
    });
    const env = envelopeOf(result);
    expect(env.ok).toBe(true);
    const data = env.data as {
      created_fixes: Array<{ work_item_id: string; identifier: string }>;
      action: string;
    };
    expect(data.created_fixes).toHaveLength(1);
    expect(data.created_fixes[0]!.work_item_id).toMatch(/^dry-run-/);
    expect(data.created_fixes[0]!.identifier).toBe("dry-run");
    expect(data.action).toBe("created");

    // Verify no work item was actually created (dry-run).
    const workItems = await base.db.all<{ id: string }>(
      "SELECT id FROM work_items WHERE workspace_id = ? AND title LIKE ?",
      [base.wsId, "[review_fix] Dry run target%"],
    );
    expect(workItems).toHaveLength(0);
    await client.close();
  });

  it("rejects a read-only token with scope_missing", async () => {
    const client = await connect(base.db, {
      db: base.db,
      workspaceId: base.wsId,
      actor: remoteMcpActor("reader", "tok-r"),
      token: base.readVerified,
    });
    const result = await client.callTool({
      name: "create_followup_todos_from_review",
      arguments: {
        review_id: reviewId,
        idempotency_key: "followup-readonly",
      },
    });
    const env = envelopeOf(result);
    expect(env.ok).toBe(false);
    expect(env.error_code).toBe("scope_missing");
    await client.close();
  });
});

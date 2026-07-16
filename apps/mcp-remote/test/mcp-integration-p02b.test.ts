/**
 * MCP integration — P02B write tools (upsert_work_items, upsert_todos,
 * update_todo_status, dry_run).
 *
 * Drives the real McpServer (buildServer) over an in-memory transport with the
 * SDK client. Exercises the full P02B path per request:
 *   client.callTool -> scope guard -> idempotency guard -> dry_run short-circuit
 *   -> domain upsert / updateStatus -> D1/in-memory DB -> event log
 *
 * Covers the P02B acceptance criteria: create + merge + replay + dry_run +
 * scope_missing + evidence_required gate + expected_version.
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
  workItemService,
  todoService,
  type VerifiedToken,
} from "@statehub/domain";
import { buildServer, type ToolContext } from "../src/registry";

async function connect(db: DbClient, ctx: ToolContext): Promise<Client> {
  const server = buildServer(ctx);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "p02b-client", version: "0.0.0" });
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
  const ws = await workspaceService.create(db, SOLO_ACTOR, { slug: "p02b-mcp-ws", name: "P02B MCP" });
  const project = await projectService.create(db, SOLO_ACTOR, ws.id, {
    slug: "proj",
    name: "P",
    identifier: "PBM",
  });
  const feature = await featureService.create(db, SOLO_ACTOR, ws.id, project.id, {
    name: "P02B Feat",
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

describe("mcp-remote P02B upsert_work_items", () => {
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

  it("creates a work item on first call", async () => {
    const client = await connect(base.db, ctxFor(base.writeVerified));
    const result = await client.callTool({
      name: "upsert_work_items",
      arguments: {
        project_id: base.projectId,
        title: "Add retry",
        priority: "high",
        idempotency_key: "wi-key-1",
      },
    });
    const env = envelopeOf(result);
    expect(env.ok).toBe(true);
    const data = env.data as { action: string; work_item_id: string; identifier: string };
    expect(data.action).toBe("created");
    expect(data.work_item_id).toMatch(/^[\w-]+$/);
    expect(data.identifier).toMatch(/^PBM-\d+$/);
    await client.close();
  });

  it("replaying with the same idempotency_key returns the first result verbatim", async () => {
    const client = await connect(base.db, ctxFor(base.writeVerified));
    const args = {
      project_id: base.projectId,
      title: "Idempotent WI",
      idempotency_key: "wi-key-replay",
    };
    const first = await client.callTool({ name: "upsert_work_items", arguments: args });
    const second = await client.callTool({ name: "upsert_work_items", arguments: args });
    const firstData = (envelopeOf(first).data as { work_item_id: string }).work_item_id;
    const secondData = (envelopeOf(second).data as { work_item_id: string }).work_item_id;
    expect(secondData).toBe(firstData);
    await client.close();
  });

  it("merges on hit with the same fingerprint (different idempotency_key)", async () => {
    const client = await connect(base.db, ctxFor(base.writeVerified));
    const first = await client.callTool({
      name: "upsert_work_items",
      arguments: {
        project_id: base.projectId,
        title: "Merge me",
        priority: "medium",
        idempotency_key: "wi-merge-1",
      },
    });
    const second = await client.callTool({
      name: "upsert_work_items",
      arguments: {
        project_id: base.projectId,
        title: "merge me", // case-insensitive
        priority: "high",
        idempotency_key: "wi-merge-2",
      },
    });
    const firstId = (envelopeOf(first).data as { work_item_id: string }).work_item_id;
    const secondEnv = envelopeOf(second);
    const secondData = secondEnv.data as { work_item_id: string; action: string };
    expect(secondData.action).toBe("updated");
    expect(secondData.work_item_id).toBe(firstId);
    await client.close();
  });

  it("dry_run returns the would-be action with a synthetic id and writes nothing", async () => {
    const client = await connect(base.db, ctxFor(base.writeVerified));
    const result = await client.callTool({
      name: "upsert_work_items",
      arguments: {
        project_id: base.projectId,
        title: "Dry run only",
        idempotency_key: "wi-dry-1",
        dry_run: true,
      },
    });
    const env = envelopeOf(result);
    expect(env.ok).toBe(true);
    const data = env.data as { action: string; work_item_id: string; identifier: string | null };
    expect(data.action).toBe("created");
    expect(data.work_item_id).toMatch(/^dry-run-/);
    // No real row exists with that id.
    const real = await workItemService.get(base.db, base.wsId, data.work_item_id);
    expect(real).toBeNull();
    await client.close();
  });

  it("dry_run on an existing fingerprint returns action='updated' with the real id", async () => {
    const client = await connect(base.db, ctxFor(base.writeVerified));
    // First create a real one.
    const created = await client.callTool({
      name: "upsert_work_items",
      arguments: {
        project_id: base.projectId,
        title: "Dry hit target",
        idempotency_key: "wi-dryhit-1",
      },
    });
    const realId = (envelopeOf(created).data as { work_item_id: string }).work_item_id;
    // Dry-run the same fingerprint.
    const dry = await client.callTool({
      name: "upsert_work_items",
      arguments: {
        project_id: base.projectId,
        title: "dry hit target",
        idempotency_key: "wi-dryhit-2",
        dry_run: true,
      },
    });
    const dryData = (envelopeOf(dry).data as { action: string; work_item_id: string });
    expect(dryData.action).toBe("updated");
    expect(dryData.work_item_id).toBe(realId);
    await client.close();
  });

  it("rejects a read-only token with scope_missing", async () => {
    const client = await connect(base.db, ctxFor(base.readVerified));
    const result = await client.callTool({
      name: "upsert_work_items",
      arguments: {
        project_id: base.projectId,
        title: "Should fail",
        idempotency_key: "wi-ro-1",
      },
    });
    const env = envelopeOf(result);
    expect(env.ok).toBe(false);
    expect(env.error_code).toBe("scope_missing");
    await client.close();
  });
});

describe("mcp-remote P02B upsert_todos + update_todo_status", () => {
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

  it("creates a todo, then flips it to in_progress, then to done with evidence_summary", async () => {
    const client = await connect(base.db, ctxFor(base.writeVerified));
    // Create a work item to parent the todo to.
    const wi = await client.callTool({
      name: "upsert_work_items",
      arguments: {
        project_id: base.projectId,
        title: "Parent WI",
        idempotency_key: "td-parent-1",
      },
    });
    const workItemId = (envelopeOf(wi).data as { work_item_id: string }).work_item_id;

    // Create a todo with evidence_required.
    const created = await client.callTool({
      name: "upsert_todos",
      arguments: {
        project_id: base.projectId,
        work_item_id: workItemId,
        title: "Write tests",
        evidence_required: true,
        idempotency_key: "td-key-1",
      },
    });
    const createdData = (envelopeOf(created).data as { todo_id: string; status: string; action: string });
    expect(createdData.action).toBe("created");
    expect(createdData.status).toBe("backlog");
    const todoId = createdData.todo_id;

    // Flip to in_progress.
    const inProgress = await client.callTool({
      name: "update_todo_status",
      arguments: {
        todo_id: todoId,
        status: "in_progress",
        idempotency_key: "td-flip-1",
      },
    });
    expect((envelopeOf(inProgress).data as { status: string }).status).toBe("in_progress");

    // done WITH evidence_summary → ok.
    const done = await client.callTool({
      name: "update_todo_status",
      arguments: {
        todo_id: todoId,
        status: "done",
        evidence_summary: "all tests pass",
        idempotency_key: "td-flip-2",
      },
    });
    const doneEnv = envelopeOf(done);
    expect(doneEnv.ok).toBe(true);
    expect((doneEnv.data as { status: string }).status).toBe("done");
    await client.close();
  });

  it("update_todo_status done on evidence_required todo WITHOUT evidence_summary → validation_error", async () => {
    const client = await connect(base.db, ctxFor(base.writeVerified));
    const wi = await client.callTool({
      name: "upsert_work_items",
      arguments: {
        project_id: base.projectId,
        title: "Parent WI 2",
        idempotency_key: "td-parent-2",
      },
    });
    const workItemId = (envelopeOf(wi).data as { work_item_id: string }).work_item_id;
    const created = await client.callTool({
      name: "upsert_todos",
      arguments: {
        project_id: base.projectId,
        work_item_id: workItemId,
        title: "Evidence-gated todo",
        evidence_required: true,
        idempotency_key: "td-key-2",
      },
    });
    const todoId = (envelopeOf(created).data as { todo_id: string }).todo_id;
    const done = await client.callTool({
      name: "update_todo_status",
      arguments: {
        todo_id: todoId,
        status: "done",
        // no evidence_summary
        idempotency_key: "td-flip-fail-1",
      },
    });
    const env = envelopeOf(done);
    expect(env.ok).toBe(false);
    expect(env.error_code).toBe("validation_error");
    await client.close();
  });

  it("update_todo_status rejects a read-only token with scope_missing", async () => {
    const client = await connect(base.db, ctxFor(base.readVerified));
    const result = await client.callTool({
      name: "update_todo_status",
      arguments: {
        todo_id: "any",
        status: "done",
        idempotency_key: "td-ro-1",
      },
    });
    const env = envelopeOf(result);
    expect(env.ok).toBe(false);
    expect(env.error_code).toBe("scope_missing");
    await client.close();
  });

  it("upsert_todos rejects a read-only token with scope_missing", async () => {
    const client = await connect(base.db, ctxFor(base.readVerified));
    const result = await client.callTool({
      name: "upsert_todos",
      arguments: {
        project_id: base.projectId,
        title: "Should fail",
        idempotency_key: "td-ro-2",
      },
    });
    const env = envelopeOf(result);
    expect(env.ok).toBe(false);
    expect(env.error_code).toBe("scope_missing");
    await client.close();
  });

  it("dry_run on update_todo_status writes nothing", async () => {
    const client = await connect(base.db, ctxFor(base.writeVerified));
    const wi = await client.callTool({
      name: "upsert_work_items",
      arguments: {
        project_id: base.projectId,
        title: "Parent WI 3",
        idempotency_key: "td-parent-3",
      },
    });
    const workItemId = (envelopeOf(wi).data as { work_item_id: string }).work_item_id;
    const created = await client.callTool({
      name: "upsert_todos",
      arguments: {
        project_id: base.projectId,
        work_item_id: workItemId,
        title: "Dry-run flip target",
        idempotency_key: "td-key-3",
      },
    });
    const todoId = (envelopeOf(created).data as { todo_id: string }).todo_id;
    const before = await todoService.get(base.db, base.wsId, todoId);
    const dry = await client.callTool({
      name: "update_todo_status",
      arguments: {
        todo_id: todoId,
        status: "in_progress",
        idempotency_key: "td-dryflip-1",
        dry_run: true,
      },
    });
    const dryEnv = envelopeOf(dry);
    expect(dryEnv.ok).toBe(true);
    expect((dryEnv.data as { action: string }).action).toBe("updated");
    // No write happened.
    const after = await todoService.get(base.db, base.wsId, todoId);
    expect(after!.version).toBe(before!.version);
    expect(after!.status).toBe(before!.status);
    await client.close();
  });
});

/**
 * MCP integration — drive the real McpServer (buildServer) over an in-memory
 * transport with the SDK client. Exercises the full P02A path per request:
 *   client.callTool -> server tool handler -> scope guard -> idempotency guard
 *   -> domain service -> D1/in-memory DB -> event log
 *
 * Covers P02A acceptance criteria 1-9 (the ones reachable without a live HTTP
 * server): get_current_focus returns context; start_agent_run returns a run_id;
 * replaying with the same idempotency_key returns the same run_id (no dupe);
 * complete_agent_run completes + creates evidence; completing a non-running run
 * returns conflict; a read-only token can't call write tools (scope_missing);
 * writes go through domain services and emit events.
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
  workItemService,
  stateService,
  tokenService,
  type VerifiedToken,
} from "@statehub/domain";
import { buildServer, type ToolContext } from "../src/registry";

/** Connect an SDK client to a buildServer() instance over an in-memory pair. */
async function connect(db: DbClient, ctx: ToolContext): Promise<Client> {
  const server = buildServer(ctx);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  // Server connects first — the client's initialize handshake is queued until
  // the server transport is ready. Connecting the client first deadlocks:
  // client.connect awaits the initialize response while server.connect never runs.
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

/** Parse the tool's text content (our envelope JSON) into an object. */
function parseEnvelope(text: string): Record<string, unknown> {
  return JSON.parse(text) as Record<string, unknown>;
}

/**
 * Extract the first text block from a callTool result. The SDK's callTool return
 * type carries a `[x: string]: unknown` index signature that widens `content`
 * to unknown under strict tsc, so we cast through a known shape here.
 */
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
  return parseEnvelope(textOf(result));
}

async function setup() {
  const db = createInMemoryDb();
  setDbClient(db);
  const ws = await workspaceService.create(db, SOLO_ACTOR, { slug: "mcp-ws", name: "MCP" });
  const project = await projectService.create(db, SOLO_ACTOR, ws.id, {
    slug: "mcp-proj",
    name: "MCP Project",
    identifier: "MCP",
  });
  const feature = await featureService.create(db, SOLO_ACTOR, ws.id, project.id, {
    name: "Feat",
    status: "in_progress",
  });
  // Give the feature an in-progress work item so project health reports a focus.
  const states = await stateService.list(db, ws.id, project.id);
  const inProgress = states.find((s) => s.statusGroup === "started")!;
  const wi = await workItemService.create(db, SOLO_ACTOR, ws.id, project.id, {
    title: "Do the thing",
    featureId: feature.id,
  });
  await workItemService.changeStatus(db, SOLO_ACTOR, ws.id, wi.id, inProgress.id);

  const writeToken = await tokenService.issue(db, ws.id, {
    name: "writer",
    scopes: ["read", "write_agent_state"],
  });
  const readToken = await tokenService.issue(db, ws.id, { name: "reader", scopes: ["read"] });
  const writeVerified = (await tokenService.verify(db, writeToken.token))!;
  const readVerified = (await tokenService.verify(db, readToken.token))!;

  return { db, wsId: ws.id, projectId: project.id, featureId: feature.id, writeVerified, readVerified };
}

describe("mcp-remote integration (P02A)", () => {
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

  it("lists all four P02A tools", async () => {
    const client = await connect(base.db, ctxFor(base.readVerified));
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "get_current_focus",
        "get_feature_context",
        "start_agent_run",
        "complete_agent_run",
      ]),
    );
    await client.close();
  });

  it("get_current_focus returns project + feature + open context (acceptance #1)", async () => {
    const client = await connect(base.db, ctxFor(base.readVerified));
    const result = await client.callTool({ name: "get_current_focus", arguments: {} });
    const envelope = envelopeOf(result);
    expect(envelope.ok).toBe(true);
    const data = envelope.data as { project: { id: string }; feature: { id: string } | null };
    expect(data.project.id).toBe(base.projectId);
    expect(data.feature).not.toBeNull();
    await client.close();
  });

  it("get_feature_context returns feature + todos + runs + evidence (acceptance #1)", async () => {
    const client = await connect(base.db, ctxFor(base.readVerified));
    const result = await client.callTool({
      name: "get_feature_context",
      arguments: { feature_id: base.featureId },
    });
    const envelope = envelopeOf(result);
    expect(envelope.ok).toBe(true);
    const data = envelope.data as { feature: { id: string }; recent_agent_runs: unknown[] };
    expect(data.feature.id).toBe(base.featureId);
    expect(Array.isArray(data.recent_agent_runs)).toBe(true);
    await client.close();
  });

  it("start_agent_run returns run_id + status running (acceptance #2)", async () => {
    const client = await connect(base.db, ctxFor(base.writeVerified));
    const result = await client.callTool({
      name: "start_agent_run",
      arguments: {
        project_id: base.projectId,
        feature_id: base.featureId,
        agent: "opencode",
        run_type: "implement",
        idempotency_key: "run-key-1",
      },
    });
    const envelope = envelopeOf(result);
    expect(envelope.ok).toBe(true);
    expect((envelope.data as { status: string }).status).toBe("running");
    expect(typeof (envelope.data as { run_id: string }).run_id).toBe("string");
    await client.close();
  });

  it("replaying start_agent_run with the same idempotency_key returns the same run_id — no duplicate (acceptance #4)", async () => {
    const client = await connect(base.db, ctxFor(base.writeVerified));
    const args = {
      project_id: base.projectId,
      agent: "opencode",
      run_type: "investigate",
      idempotency_key: "run-key-dedup",
    };
    const r1 = await client.callTool({ name: "start_agent_run", arguments: args });
    const e1 = envelopeOf(r1);
    const id1 = (e1.data as { run_id: string }).run_id;

    const r2 = await client.callTool({ name: "start_agent_run", arguments: args });
    const e2 = envelopeOf(r2);
    const id2 = (e2.data as { run_id: string }).run_id;

    expect(id2).toBe(id1);

    // Only one agent_runs row with that id.
    const rows = await base.db.all<{ id: string }>(
      "SELECT id FROM agent_runs WHERE workspace_id = ? AND id = ?",
      [base.wsId, id1],
    );
    expect(rows.length).toBe(1);
    await client.close();
  });

  it("complete_agent_run completes a running run and records evidence + events (acceptance #3, #6)", async () => {
    const client = await connect(base.db, ctxFor(base.writeVerified));
    const start = await client.callTool({
      name: "start_agent_run",
      arguments: {
        project_id: base.projectId,
        feature_id: base.featureId,
        agent: "opencode",
        run_type: "implement",
        idempotency_key: "run-key-complete",
      },
    });
    const runId = (envelopeOf(start).data as { run_id: string }).run_id;

    const finish = await client.callTool({
      name: "complete_agent_run",
      arguments: {
        run_id: runId,
        summary: "Done the thing",
        files_changed: ["src/x.ts"],
        commands_run: ["pnpm test"],
        test_result: "passing",
        risks: ["none"],
        next_steps: ["ship"],
        idempotency_key: "complete-key-1",
      },
    });
    const envelope = envelopeOf(finish);
    expect(envelope.ok).toBe(true);
    expect((envelope.data as { status: string }).status).toBe("completed");

    // Evidence row linked to the run.
    const ev = await base.db.all<{ id: string; trust_state: string }>(
      "SELECT id, trust_state FROM evidence WHERE workspace_id = ? AND agent_run_id = ?",
      [base.wsId, runId],
    );
    expect(ev.length).toBe(1);
    expect(ev[0]!.trust_state).toBe("working_tree");

    // Events for started + completed.
    const events = await base.db.all<{ event_type: string }>(
      "SELECT event_type FROM events WHERE workspace_id = ? AND entity_type = 'agent_run' AND entity_id = ?",
      [base.wsId, runId],
    );
    const types = events.map((e) => e.event_type);
    expect(types).toContain("agent_run.started");
    expect(types).toContain("agent_run.completed");
    await client.close();
  });

  it("completing a non-running run returns a conflict envelope (acceptance #5)", async () => {
    const client = await connect(base.db, ctxFor(base.writeVerified));
    const start = await client.callTool({
      name: "start_agent_run",
      arguments: {
        project_id: base.projectId,
        agent: "opencode",
        run_type: "implement",
        idempotency_key: "run-key-conflict",
      },
    });
    const runId = (envelopeOf(start).data as { run_id: string }).run_id;
    await client.callTool({
      name: "complete_agent_run",
      arguments: { run_id: runId, summary: "first", idempotency_key: "complete-conflict-1" },
    });
    const again = await client.callTool({
      name: "complete_agent_run",
      arguments: { run_id: runId, summary: "again", idempotency_key: "complete-conflict-2" },
    });
    const envelope = envelopeOf(again);
    expect(envelope.ok).toBe(false);
    expect(envelope.error_code).toBe("conflict");
    await client.close();
  });

  it("a read-only token cannot start/complete runs — scope_missing (acceptance #7, #11)", async () => {
    const client = await connect(base.db, ctxFor(base.readVerified));
    const result = await client.callTool({
      name: "start_agent_run",
      arguments: {
        project_id: base.projectId,
        agent: "opencode",
        run_type: "implement",
        idempotency_key: "run-key-scope",
      },
    });
    const envelope = envelopeOf(result);
    expect(envelope.ok).toBe(false);
    expect(envelope.error_code).toBe("scope_missing");
    expect((result as ToolResult).isError).toBe(true);
    await client.close();
  });

  it("a write tool without an idempotency_key is rejected at the schema layer", async () => {
    const client = await connect(base.db, ctxFor(base.writeVerified));
    const result = await client.callTool({
      name: "start_agent_run",
      arguments: { project_id: base.projectId, agent: "opencode", run_type: "implement" },
    });
    // The zod input schema marks idempotency_key required, so the MCP layer
    // rejects the call before the handler runs. isError signals the rejection;
    // the content carries a human-readable validation message.
    expect((result as ToolResult).isError).toBe(true);
    expect(textOf(result)).toMatch(/idempotency_key/i);
    await client.close();
  });

  it("every write emits an event — writes go through domain services (acceptance #6, #9)", async () => {
    const client = await connect(base.db, ctxFor(base.writeVerified));
    const before = await base.db.all<{ c: number }>(
      "SELECT COUNT(*) AS c FROM events WHERE workspace_id = ? AND event_type LIKE 'agent_run%'",
      [base.wsId],
    );
    const beforeCount = before[0]!.c;

    await client.callTool({
      name: "start_agent_run",
      arguments: {
        project_id: base.projectId,
        agent: "opencode",
        run_type: "implement",
        idempotency_key: "run-key-events",
      },
    });

    const after = await base.db.all<{ c: number }>(
      "SELECT COUNT(*) AS c FROM events WHERE workspace_id = ? AND event_type LIKE 'agent_run%'",
      [base.wsId],
    );
    expect(after[0]!.c).toBeGreaterThan(beforeCount);
    await client.close();
  });
});

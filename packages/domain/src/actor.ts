/**
 * Actor context — who is performing the action.
 *
 * Source: agent_flow/implementation/v1/02-cross-cutting-architecture.md §3
 *
 * Every service method takes an ActorContext explicitly. The service NEVER
 * infers the actor from the request — the caller (API route, MCP tool, worker)
 * is responsible for authenticating and constructing the actor.
 *
 * P01A ships with a single actor: the solo developer. Auth comes later.
 */
import type { ActorContext } from "@statehub/db";

/**
 * The solo developer actor. Used by API routes and seed scripts until
 * multi-user auth lands.
 */
export const SOLO_ACTOR: ActorContext = Object.freeze({
  type: "user",
  id: "solo",
  name: "solo",
});

/**
 * Build an actor context for an MCP tool action.
 */
export function mcpActor(name: string, id?: string): ActorContext {
  return { type: "local_mcp", id, name };
}

/**
 * Build an actor context for the AI PM.
 */
export function aiPmActor(name = "ai-pm"): ActorContext {
  return { type: "ai_pm", name };
}

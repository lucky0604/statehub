/**
 * Server-side data fetchers for the AI PM UI.
 *
 * Same pattern as queries.ts — calls domain services in-process from server
 * components. The API routes exist for external/mutation callers; server
 * components use these helpers to avoid an HTTP loopback.
 */
import {
  actionCardService,
  weeklyReviewService,
  decisionService,
  type AiPmActionCard,
  type WeeklyReview,
  type Decision,
} from "@statehub/domain";
import { db } from "./server";

export async function listActionCards(
  workspaceId: string,
  filter?: { status?: "pending" | "applied" | "dismissed"; featureId?: string; projectId?: string },
): Promise<AiPmActionCard[]> {
  return actionCardService.list(db(), workspaceId, filter);
}

export async function listWeeklyReviews(
  workspaceId: string,
  filter?: { projectId?: string | null },
): Promise<WeeklyReview[]> {
  return weeklyReviewService.list(db(), workspaceId, filter);
}

export async function listDecisions(
  workspaceId: string,
  filter?: { projectId?: string; featureId?: string },
): Promise<Decision[]> {
  return decisionService.list(db(), workspaceId, filter);
}

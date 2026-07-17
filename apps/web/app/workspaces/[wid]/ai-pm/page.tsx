import { notFound } from "next/navigation";
import { requireWorkspace, listProjects, listFeatures } from "@/lib/queries";
import { listActionCards, listWeeklyReviews } from "@/lib/ai-pm-queries";
import { AIPMDock } from "@/components/ai-pm/ai-pm-dock";

/**
 * AI PM page — the writable AI PM surface.
 *
 * Source: agent_flow/implementation/v1/phases/phase-05-writable-ai-pm.md §6
 *
 * Server component. Loads projects + features for the context selectors,
 * all action cards (pending + applied + dismissed so the user can see the
 * full lifecycle after apply/dismiss), and the saved weekly reviews. The
 * AIPMDock client component handles mode switching + query/apply/dismiss
 * mutations and calls router.refresh() to re-fetch this data after each
 * mutation.
 */
export default async function AIPMPage({
  params,
}: {
  params: Promise<{ wid: string }>;
}) {
  const { wid } = await params;
  const ws = await requireWorkspace();
  if (ws.id !== wid) notFound();

  const [projects, allCards, weeklyReviews] = await Promise.all([
    listProjects(wid),
    listActionCards(wid),
    listWeeklyReviews(wid),
  ]);

  // Load features across all projects (for the feature selector).
  const features = (
    await Promise.all(projects.map((p) => listFeatures(wid, p.id)))
  ).flat();

  return (
    <div
      className="mx-auto flex max-w-[1100px] flex-col gap-4 p-4"
      data-testid="ai-pm-page"
    >
      <header className="rounded-md border border-border-subtle bg-surface-1 p-4">
        <h1 className="text-[18px] font-semibold text-txt-primary">AI PM</h1>
        <p className="mt-0.5 text-[12px] text-txt-secondary">
          The writable AI PM. Ask for advice, plans, review triage, weekly
          reviews, or coding-agent prompts. Proposed actions become cards you
          can apply, edit, or dismiss.
        </p>
      </header>

      <AIPMDock
        workspaceId={wid}
        projects={projects}
        features={features}
        initialCards={allCards}
        weeklyReviews={weeklyReviews}
      />
    </div>
  );
}

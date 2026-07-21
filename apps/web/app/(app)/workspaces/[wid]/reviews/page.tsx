import { notFound } from "next/navigation";
import Link from "next/link";

import { requireWorkspace, listProjects, listReviews } from "@/lib/queries";
import { reviewService, type ReviewFinding, type ReviewVerdict, type Feature } from "@statehub/domain";
import { db } from "@/lib/server";
import { ReviewLedgerTable } from "@/components/reviews/review-ledger-table";

/**
 * Review Ledger page — workspace-scoped list of every review, newest first.
 *
 * Source: agent_flow/implementation/v1/iterations/20260716-p03c-ui-e2e-docs/plan.md §2.1
 *
 * Sidebar "Reviews" links here. Each row's Target links to the Feature Detail
 * page (when the review is feature-scoped). Optional ?verdict= filter.
 */
export default async function ReviewsPage({
  params,
  searchParams,
}: {
  params: Promise<{ wid: string }>;
  searchParams: Promise<{ verdict?: string }>;
}) {
  const { wid } = await params;
  const ws = await requireWorkspace();
  if (ws.id !== wid) notFound();

  const sp = await searchParams;
  const verdictFilter = (sp.verdict as ReviewVerdict | undefined) ?? undefined;

  const [projects, reviews] = await Promise.all([
    listProjects(wid),
    listReviews(wid, verdictFilter ? { verdict: verdictFilter, limit: 100 } : { limit: 100 }),
  ]);

  const projectById = new Map(projects.map((p) => [p.id, p] as const));

  // Resolve feature names for the Target column.
  const featureById = new Map<string, Feature>();
  const featureIds = new Set(reviews.map((r) => r.featureId).filter((id): id is string => !!id));
  for (const p of projects) {
    if (featureIds.size === 0) break;
    const rows = await db().all<
      Record<string, unknown>
    >(
      "SELECT * FROM features WHERE workspace_id = ? AND project_id = ? AND deleted_at IS NULL",
      [wid, p.id],
    );
    for (const row of rows) {
      const id = row.id as string;
      if (!featureIds.has(id)) continue;
      featureById.set(id, {
        id,
        workspaceId: row.workspace_id as string,
        projectId: row.project_id as string,
        name: row.name as string,
        description: (row.description as string | null) ?? null,
        status: row.status as Feature["status"],
        sortOrder: row.sort_order as number,
        createdAt: row.created_at as number,
        updatedAt: row.updated_at as number,
        deletedAt: null,
        version: row.version as number,
        createdBy: (row.created_by as string | null) ?? null,
        updatedBy: (row.updated_by as string | null) ?? null,
      });
    }
  }

  // Findings per review. N+1 is acceptable for small workspaces; a follow-up
  // can batch with a single grouped query.
  const findingsByReview = new Map<string, ReviewFinding[]>();
  for (const r of reviews) {
    const findings = await reviewService.listFindings(db(), wid, r.id);
    findingsByReview.set(r.id, findings);
  }

  const VERDICTS: ReviewVerdict[] = ["approved", "needs_changes", "blocked", "informational"];

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-4 p-4" data-testid="reviews-page">
      <header className="rounded-md border border-border-subtle bg-surface-1 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-[18px] font-semibold text-txt-primary">Reviews</h1>
            <p className="mt-0.5 text-[12px] text-txt-secondary">
              Every agent review in this workspace, newest first.
            </p>
          </div>
          <div className="flex items-center gap-1.5" role="group" aria-label="Filter by verdict">
            <Link
              href={`/workspaces/${wid}/reviews`}
              aria-current={!verdictFilter ? "page" : undefined}
              className={
                "rounded-md border px-2.5 py-1 text-[12px] " +
                (!verdictFilter
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border-subtle bg-surface-2 text-txt-secondary hover:bg-surface-1")
              }
            >
              All
            </Link>
            {VERDICTS.map((v) => {
              const active = verdictFilter === v;
              return (
                <Link
                  key={v}
                  href={`/workspaces/${wid}/reviews?verdict=${v}`}
                  aria-current={active ? "page" : undefined}
                  className={
                    "rounded-md border px-2.5 py-1 text-[12px] capitalize " +
                    (active
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-border-subtle bg-surface-2 text-txt-secondary hover:bg-surface-1")
                  }
                >
                  {v.replace("_", " ")}
                </Link>
              );
            })}
          </div>
        </div>
      </header>

      <ReviewLedgerTable
        workspaceId={wid}
        reviews={reviews}
        findingsByReview={findingsByReview}
        projectById={projectById}
        featureById={featureById}
      />
    </div>
  );
}

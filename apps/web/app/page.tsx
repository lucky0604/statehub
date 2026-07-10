import Link from "next/link";

import { requireWorkspace, listProjects } from "@/lib/queries";

/**
 * Portfolio dashboard — the home page.
 *
 * Shows the current workspace's projects. For solo dev there's one workspace;
 * the project list is the landing surface.
 */
export default async function HomePage() {
  let ws;
  try {
    ws = await requireWorkspace();
  } catch {
    return <EmptyWorkspace />;
  }

  const projects = await listProjects(ws.id);

  return (
    <div className="mx-auto max-w-5xl py-6">
      <header className="mb-6">
        <h1 className="text-[18px] font-semibold text-txt-primary">
          {ws.name}
        </h1>
        <p className="mt-0.5 text-[13px] text-txt-secondary">
          {projects.length} project{projects.length === 1 ? "" : "s"}
        </p>
      </header>

      {projects.length === 0 ? (
        <div className="rounded-md border border-border-subtle bg-surface-1 p-8 text-center">
          <p className="text-[13px] text-txt-secondary">No projects yet.</p>
          <p className="mt-1 text-[12px] text-txt-tertiary">
            Run <code className="font-mono-app">pnpm db:seed</code> to create a
            sample project, or create one via the API.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <Link
              key={p.id}
              href={`/workspaces/${ws.id}/projects/${p.id}`}
              className="block rounded-md border border-border-subtle bg-surface-1 p-4 transition-colors hover:border-border-strong hover:bg-surface-2"
            >
              <div className="flex items-center justify-between">
                <span className="font-mono-app text-[11px] text-accent">
                  {p.identifier}
                </span>
                <span className="text-[11px] text-txt-tertiary">
                  {p.slug}
                </span>
              </div>
              <h3 className="mt-1.5 text-[14px] font-semibold text-txt-primary">
                {p.name}
              </h3>
              {p.description ? (
                <p className="mt-1 line-clamp-2 text-[12px] text-txt-tertiary">
                  {p.description}
                </p>
              ) : null}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyWorkspace() {
  return (
    <div className="mx-auto max-w-2xl py-12">
      <h1 className="text-[20px] font-semibold text-txt-primary">StateHub</h1>
      <p className="mt-1 text-[13px] text-txt-secondary">
        AI-native project manager for solo builders.
      </p>
      <div className="mt-8 rounded-md border border-border-subtle bg-surface-1 p-6">
        <h2 className="text-[15px] font-semibold text-txt-primary">
          Welcome — let&apos;s set up your workspace
        </h2>
        <p className="mt-1 text-[13px] text-txt-tertiary">
          No workspace exists yet. Run{" "}
          <code className="font-mono-app">pnpm db:seed</code> from the repo root
          to create a solo workspace with a sample project.
        </p>
      </div>
    </div>
  );
}

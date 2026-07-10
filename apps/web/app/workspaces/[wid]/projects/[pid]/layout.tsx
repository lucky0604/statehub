import { notFound } from "next/navigation";

import { requireWorkspace, getProject, listStates } from "@/lib/queries";

/**
 * Project layout — loads the project + its states once, renders the project
 * header, and passes children through for the tab content.
 */
export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ wid: string; pid: string }>;
}) {
  const { wid, pid } = await params;
  const ws = await requireWorkspace();
  if (ws.id !== wid) notFound();

  const project = await getProject(wid, pid);
  if (!project) notFound();

  const states = await listStates(wid, pid);

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-border-subtle bg-surface-1 px-5 py-3">
        <div className="flex items-center gap-2 text-[12px] text-txt-tertiary">
          <span className="font-mono-app text-accent">{project.identifier}</span>
          <span>/</span>
          <span>{project.name}</span>
        </div>
        <h1 className="mt-0.5 text-[16px] font-semibold text-txt-primary">
          {project.name}
        </h1>
        {project.description ? (
          <p className="mt-0.5 text-[12px] text-txt-secondary">
            {project.description}
          </p>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {states.map((s) => (
            <span
              key={s.id}
              className="inline-flex items-center gap-1 rounded-xs border border-border-subtle px-1.5 py-0.5 text-[11px] text-txt-secondary"
            >
              {s.color ? (
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: s.color }}
                  aria-hidden
                />
              ) : null}
              {s.name}
            </span>
          ))}
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}

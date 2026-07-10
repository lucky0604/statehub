import Link from "next/link";
import { notFound } from "next/navigation";

import {
  requireWorkspace,
  getProject,
  getWorkItem,
  listStates,
} from "@/lib/queries";
import { StatusBadge } from "@/components/status-badge";

/**
 * Work item detail — the per-item view.
 *
 * P01A renders read-only detail + a status change control. Inline editing,
 * comments, and activity feed land in P01B/P01C.
 */
export default async function WorkItemPage({
  params,
}: {
  params: Promise<{ wid: string; pid: string; wiid: string }>;
}) {
  const { wid, pid, wiid } = await params;
  const ws = await requireWorkspace();
  if (ws.id !== wid) notFound();

  const project = await getProject(wid, pid);
  if (!project) notFound();

  const item = await getWorkItem(wid, wiid);
  if (!item) notFound();

  const states = await listStates(wid, pid);
  const currentState = item.stateId
    ? states.find((s) => s.id === item.stateId)
    : undefined;

  return (
    <div className="mx-auto max-w-3xl px-5 py-5">
      <div className="mb-3 flex items-center gap-2 text-[12px] text-txt-tertiary">
        <Link
          href={`/workspaces/${wid}/projects/${pid}`}
          className="hover:text-txt-primary"
        >
          ← {project.name}
        </Link>
      </div>

      <div className="mb-2 flex items-center gap-3">
        <span className="font-mono-app text-[12px] text-accent">
          {item.projectIdentifier}-{item.sequenceId}
        </span>
        <StatusBadge group={item.statusGroup} />
        <span className="text-[11px] capitalize text-txt-tertiary">
          {item.type}
        </span>
        <span className="text-[11px] capitalize text-txt-tertiary">
          {item.priority} priority
        </span>
      </div>

      <h1 className="text-[18px] font-semibold text-txt-primary">
        {item.title}
      </h1>

      {item.descriptionMarkdown ? (
        <div className="mt-4 whitespace-pre-wrap rounded-md border border-border-subtle bg-surface-1 p-4 text-[13px] leading-relaxed text-txt-secondary">
          {item.descriptionMarkdown}
        </div>
      ) : (
        <p className="mt-4 text-[12px] text-txt-tertiary italic">
          No description.
        </p>
      )}

      <dl className="mt-5 grid grid-cols-2 gap-3 text-[12px]">
        <Field label="State">
          {currentState ? (
            <span className="flex items-center gap-1.5">
              {currentState.color ? (
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: currentState.color }}
                  aria-hidden
                />
              ) : null}
              {currentState.name}
            </span>
          ) : (
            <span className="text-txt-tertiary italic">Unset</span>
          )}
        </Field>
        <Field label="Source">
          <span className="capitalize">{item.source}</span>
        </Field>
        <Field label="Confidence">
          <span className="capitalize">{item.confidence}</span>
        </Field>
        <Field label="Version">
          {item.version}
        </Field>
      </dl>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border-subtle bg-surface-1 px-3 py-2">
      <dt className="text-[11px] uppercase tracking-wide text-txt-tertiary">
        {label}
      </dt>
      <dd className="mt-0.5 text-[13px] text-txt-primary">{children}</dd>
    </div>
  );
}

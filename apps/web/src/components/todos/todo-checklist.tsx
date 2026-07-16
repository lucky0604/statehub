import type { Todo } from "@statehub/domain";

/**
 * Todo checklist — read-only list in P02C. Todos arrive via agent write tools
 * (P02B) or seed scripts; the UI displays them with status + the
 * evidence_required marker.
 *
 * Source: agent_flow/implementation/v1/phases/phase-02-minimum-agent-sync-loop.md §3.2
 *         agent_flow/statehub-design-system.md §10.3 (Peek checklist)
 */
interface Props {
  todos: Todo[];
  emptyHint?: string;
}

const STATUS_DOT: Record<Todo["status"], string> = {
  backlog: "bg-txt-tertiary",
  in_progress: "bg-accent",
  done: "bg-success",
  cancelled: "bg-txt-placeholder",
};

export function TodoChecklist({ todos, emptyHint = "No todos." }: Props) {
  return (
    <section
      className="rounded-md border border-border-subtle bg-surface-1 p-3"
      aria-label="Todos"
      data-testid="todo-checklist"
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[11px] font-medium uppercase tracking-wide text-txt-tertiary">
          Todos
        </div>
        <span className="text-[10px] text-txt-tertiary">{todos.length} item(s)</span>
      </div>
      {todos.length === 0 ? (
        <p className="text-[12px] text-txt-tertiary italic">{emptyHint}</p>
      ) : (
        <ul className="space-y-1.5">
          {todos.map((t) => (
            <li
              key={t.id}
              className="flex items-start gap-2 rounded-md border border-border-subtle bg-surface-2 px-2.5 py-1.5"
            >
              <span
                className={`mt-1 h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[t.status]}`}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <div
                  className={`text-[13px] ${
                    t.status === "done" || t.status === "cancelled"
                      ? "text-txt-tertiary line-through"
                      : "text-txt-primary"
                  }`}
                >
                  {t.title}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-txt-tertiary">
                  <span className="capitalize">{t.status.replace("_", " ")}</span>
                  <span>·</span>
                  <span className="capitalize">{t.type}</span>
                  {t.evidenceRequired === 1 ? (
                    <>
                      <span>·</span>
                      <span className="text-warning">evidence required</span>
                    </>
                  ) : null}
                  {t.evidenceSummary ? (
                    <>
                      <span>·</span>
                      <span className="italic">{t.evidenceSummary}</span>
                    </>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

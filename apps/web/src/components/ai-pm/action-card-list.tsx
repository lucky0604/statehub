import type { AiPmActionCard } from "@statehub/domain";
import { ActionCard } from "./action-card";

/**
 * Action Card List — groups cards by status (pending first, then applied,
 * then dismissed). Each card is interactive via the ActionCard client
 * component.
 */
interface Props {
  workspaceId: string;
  cards: AiPmActionCard[];
}

export function ActionCardList({ workspaceId, cards }: Props) {
  if (cards.length === 0) {
    return (
      <div
        className="rounded-md border border-dashed border-border-subtle bg-surface-1 p-6 text-center text-[12px] text-txt-tertiary"
        data-testid="action-card-list-empty"
      >
        No action cards yet. Run a query above to get AI PM suggestions.
      </div>
    );
  }

  const pending = cards.filter((c) => c.status === "pending");
  const applied = cards.filter((c) => c.status === "applied");
  const dismissed = cards.filter((c) => c.status === "dismissed");

  return (
    <div className="flex flex-col gap-4" data-testid="action-card-list">
      {pending.length > 0 ? (
        <section>
          <h3 className="mb-2 text-[12px] font-medium uppercase tracking-wide text-txt-tertiary">
            Pending ({pending.length})
          </h3>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {pending.map((c) => (
              <ActionCard key={c.id} workspaceId={workspaceId} card={c} />
            ))}
          </div>
        </section>
      ) : null}

      {applied.length > 0 ? (
        <section>
          <h3 className="mb-2 text-[12px] font-medium uppercase tracking-wide text-txt-tertiary">
            Applied ({applied.length})
          </h3>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {applied.map((c) => (
              <ActionCard key={c.id} workspaceId={workspaceId} card={c} />
            ))}
          </div>
        </section>
      ) : null}

      {dismissed.length > 0 ? (
        <section>
          <h3 className="mb-2 text-[12px] font-medium uppercase tracking-wide text-txt-tertiary">
            Dismissed ({dismissed.length})
          </h3>
          <div className="grid grid-cols-1 gap-2 opacity-60 md:grid-cols-2">
            {dismissed.map((c) => (
              <ActionCard key={c.id} workspaceId={workspaceId} card={c} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

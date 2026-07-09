import { cn } from "../lib/cn";

/**
 * RightRail — 336px context panel.
 * Source: design system §9.4
 *
 * P00: AI PM / Next Action / Risk / Recent Evidence placeholders.
 * Context-sensitive content lands P01A+.
 */
export function RightRail({ className }: { className?: string }) {
  return (
    <aside
      className={cn(
        "hidden w-[var(--right-rail-width)] shrink-0 flex-col gap-3 border-l border-border-subtle bg-surface-1 p-3 lg:flex",
        className,
      )}
      aria-label="Context rail"
      data-testid="right-rail"
    >
      <RailSection title="AI PM" hint="read-only summary lands P01C" />
      <RailSection title="Next Action" hint="lands P01A" />
      <RailSection title="Risks" hint="lands P03" />
      <RailSection title="Recent Evidence" hint="lands P02" />
    </aside>
  );
}

function RailSection({
  title,
  hint,
}: {
  title: string;
  hint: string;
}) {
  return (
    <section className="rounded-md border border-border-subtle bg-surface-2 p-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-txt-tertiary">
        {title}
      </div>
      <div className="mt-1 text-[12px] text-txt-placeholder">{hint}</div>
    </section>
  );
}

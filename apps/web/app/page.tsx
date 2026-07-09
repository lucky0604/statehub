/**
 * P00 root page. Shows an empty-state placeholder.
 * Real Portfolio Dashboard lands P01C.
 */
export default function HomePage() {
  return (
    <div className="mx-auto max-w-3xl py-12">
      <h1 className="text-[20px] font-semibold text-txt-primary">
        StateHub
      </h1>
      <p className="mt-1 text-[13px] text-txt-secondary">
        AI-native project manager for solo builders. Foundation P00 is live.
      </p>

      <div className="mt-8 rounded-md border border-border-subtle bg-surface-1 p-6">
        <h2 className="text-[15px] font-semibold text-txt-primary">
          No project selected
        </h2>
        <p className="mt-1 text-[13px] text-txt-tertiary">
          Portfolio, Projects, and Work Items land at P01A. MCP, Reviews, and
          Agent Runs land at P02+.
        </p>
      </div>

      <div className="mt-4 rounded-md border border-border-subtle bg-surface-2 p-4 text-[12px] text-txt-tertiary">
        <div>
          Health:{" "}
          <a
            href="/api/health"
            className="text-accent hover:underline"
          >
            /api/health
          </a>
        </div>
        <div className="mt-1">
          Press <kbd className="font-mono-app">⌘K</kbd> for the command palette.
        </div>
      </div>
    </div>
  );
}

"use client";

import {
  ConfigSnippet,
  useConfigSnippets,
} from "@/components/local-mcp/config-snippet";

/**
 * LocalMcpSetup — interactive client component that renders project picker,
 * config template, OpenCode/Codex snippets, and trust-model explainer.
 *
 * Source: agent_flow/implementation/v1/iterations/20260716-p04c-ui-docs-e2e/plan.md §2.2
 */
interface Props {
  remoteUrl: string;
  workspaceSlug: string;
  projects: Array<{ slug: string; name: string }>;
}

export function LocalMcpSetup({ remoteUrl, workspaceSlug, projects }: Props) {
  const { selectedSlug, setSelectedSlug, configJson, openCode, codex } = useConfigSnippets(
    remoteUrl,
    workspaceSlug,
    projects,
  );

  return (
    <div className="space-y-4">
      <section className="rounded-md border border-border-subtle bg-surface-1 p-4">
        <div className="text-[11px] font-medium uppercase tracking-wide text-txt-tertiary">
          Remote MCP
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <div>
            <div className="text-[11px] text-txt-tertiary">URL</div>
            <div className="font-mono-app text-[13px] text-txt-primary" data-testid="remote-url">
              {remoteUrl}
            </div>
          </div>
          <a
            href="/settings/tokens"
            className="ml-auto rounded-md border border-border-subtle px-3 py-1 text-[12px] text-accent hover:bg-layer-2"
            data-testid="issue-token-link"
          >
            Issue token →
          </a>
        </div>
      </section>

      <section className="rounded-md border border-border-subtle bg-surface-1 p-4">
        <div className="text-[11px] font-medium uppercase tracking-wide text-txt-tertiary">
          .statehub/config.json
        </div>
        <p className="mt-1 text-[11px] text-txt-tertiary">
          Place this file at the root of your repo. The token NEVER goes in the config — only the name of the env var that holds it.
        </p>
        <label className="mt-3 block text-[12px] font-medium text-txt-secondary">
          Project
          <select
            value={selectedSlug}
            onChange={(e) => setSelectedSlug(e.target.value)}
            className="mt-1 block w-full rounded-md border border-border-subtle bg-surface-1 px-2 py-1 text-[13px]"
            data-testid="project-select"
          >
            {projects.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.name} ({p.slug})
              </option>
            ))}
          </select>
        </label>
        <div className="mt-3">
          <ConfigSnippet
            label="config.json"
            filename="<repo>/.statehub/config.json"
            content={configJson}
            testId="config-snippet"
          />
        </div>
      </section>

      <ConfigSnippet
        label="OpenCode config"
        filename="opencode.json"
        content={openCode}
        testId="opencode-snippet"
      />

      <ConfigSnippet
        label="Codex config"
        filename="~/.codex/config.toml (JSON shown — convert to TOML)"
        content={codex}
        testId="codex-snippet"
      />

      <section className="rounded-md border border-border-subtle bg-surface-1 p-4">
        <div className="text-[11px] font-medium uppercase tracking-wide text-txt-tertiary">
          Trust model
        </div>
        <ul className="mt-2 space-y-1 text-[12px] text-txt-secondary">
          <li>
            <span className="font-mono-app text-success">trusted</span> — clean commit, repo URL matches the project&apos;s canonical repo_url or an alias.
          </li>
          <li>
            <span className="font-mono-app text-warning">working_tree</span> — dirty working tree (uncommitted or untracked files). Not yet git-verified.
          </li>
          <li>
            <span className="font-mono-app text-danger">untrusted</span> — repo URL unknown to this workspace. sync_evidence still records the row but the Done Gate blocks.
          </li>
          <li>
            <span className="font-mono-app text-txt-tertiary">unknown</span> — not yet assessed.
          </li>
        </ul>
        <p className="mt-2 text-[11px] text-txt-tertiary">
          dirty_state=true blocks auto-done. Commit your work and re-sync to upgrade evidence from working_tree to trusted.
        </p>
      </section>
    </div>
  );
}

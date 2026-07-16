"use client";

import { useState, useMemo } from "react";
import { Button } from "../ui/button";

/**
 * ConfigSnippet — renders a code block with a Copy button.
 *
 * Source: agent_flow/implementation/v1/iterations/20260716-p04c-ui-docs-e2e/plan.md §2.2
 */
interface Props {
  label: string;
  filename?: string;
  content: string;
  testId: string;
}

export function ConfigSnippet({ label, filename, content, testId }: Props) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="rounded-md border border-border-subtle bg-surface-1 p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-txt-tertiary">
            {label}
          </div>
          {filename ? (
            <div className="mt-0.5 font-mono-app text-[11px] text-txt-secondary">{filename}</div>
          ) : null}
        </div>
        <Button onClick={copy} variant="ghost" size="sm" data-testid={`${testId}-copy`}>
          {copied ? "Copied!" : "Copy"}
        </Button>
      </div>
      <pre
        className="mt-3 overflow-x-auto rounded-md bg-canvas px-3 py-2 font-mono-app text-[11px] text-txt-primary"
        data-testid={testId}
      >
        {content}
      </pre>
    </div>
  );
}

/** Build the .statehub/config.json template for a given project. */
export function buildConfigJson(remoteUrl: string, workspaceSlug: string, projectSlug: string): string {
  return JSON.stringify(
    {
      remoteUrl,
      workspaceSlug,
      projectSlug,
      tokenEnv: "STATEHUB_TOKEN",
      repoAliases: [],
    },
    null,
    2,
  );
}

/** Build the OpenCode mcp config snippet. */
export function buildOpenCodeSnippet(): string {
  return JSON.stringify(
    {
      mcp: {
        "statehub-local": {
          type: "local",
          command: ["pnpm", "--filter", "@statehub/mcp-local", "dev"],
          environment: { STATEHUB_TOKEN: "${STATEHUB_TOKEN}" },
        },
      },
    },
    null,
    2,
  );
}

/** Build the Codex mcp config snippet. */
export function buildCodexSnippet(): string {
  return JSON.stringify(
    {
      mcp_servers: {
        "statehub-local": {
          command: "pnpm",
          args: ["--filter", "@statehub/mcp-local", "dev"],
          env: { STATEHUB_TOKEN: "${STATEHUB_TOKEN}" },
        },
      },
    },
    null,
    2,
  );
}

/** Hook for selecting a project + computing snippets. */
export function useConfigSnippets(
  remoteUrl: string,
  workspaceSlug: string,
  projects: Array<{ slug: string; name: string }>,
) {
  const [selectedSlug, setSelectedSlug] = useState(projects[0]?.slug ?? "");

  const configJson = useMemo(
    () => buildConfigJson(remoteUrl, workspaceSlug, selectedSlug),
    [remoteUrl, workspaceSlug, selectedSlug],
  );
  const openCode = useMemo(() => buildOpenCodeSnippet(), []);
  const codex = useMemo(() => buildCodexSnippet(), []);

  return { selectedSlug, setSelectedSlug, configJson, openCode, codex };
}

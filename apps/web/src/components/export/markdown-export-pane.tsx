"use client";

import { useState, useTransition } from "react";
import { Copy, Check, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api-client";

/**
 * Markdown export pane — pick a project, toggle sections, generate, copy,
 * download. Generation is server-side; this component just calls the API
 * and renders the result.
 */
interface Props {
  workspaceId: string;
  projects: Array<{ id: string; name: string; identifier: string }>;
  initialMarkdown: string;
  initialByteLength: number;
  initialProjectIds: string[];
}

interface ExportResponse {
  markdown: string;
  generated_at: number;
  byte_length: number;
  project_ids: string[];
}

export function MarkdownExportPane({
  workspaceId,
  projects,
  initialMarkdown,
  initialByteLength,
  initialProjectIds,
}: Props) {
  const [projectId, setProjectId] = useState<string>("");
  const [includeReviews, setIncludeReviews] = useState(true);
  const [includeEvidence, setIncludeEvidence] = useState(true);
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const [byteLength, setByteLength] = useState(initialByteLength);
  const [projectIds, setProjectIds] = useState(initialProjectIds);
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const base = `/api/workspaces/${workspaceId}/export/markdown`;

  function buildQuery() {
    const params = new URLSearchParams();
    if (projectId) params.set("project_id", projectId);
    params.set("include_reviews", includeReviews ? "1" : "0");
    params.set("include_evidence", includeEvidence ? "1" : "0");
    return params.toString();
  }

  function generate() {
    setError(null);
    setCopied(false);
    startTransition(async () => {
      try {
        const result = await api.get<ExportResponse>(`${base}?${buildQuery()}`);
        setMarkdown(result.markdown);
        setByteLength(result.byte_length);
        setProjectIds(result.project_ids);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Export failed");
      }
    });
  }

  async function copyMarkdown() {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Clipboard write failed — copy manually.");
    }
  }

  function downloadMarkdown() {
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const stamp = new Date().toISOString().slice(0, 10);
    const name = projectId
      ? `${projects.find((p) => p.id === projectId)?.identifier ?? "project"}-${stamp}.md`
      : `workspace-${stamp}.md`;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4" data-testid="markdown-export-pane">
      {error ? (
        <div className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-[12px] text-danger">
          {error}
        </div>
      ) : null}

      <div className="rounded-md border border-border-subtle bg-surface-1 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-[12px] text-txt-secondary">
            Project
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="rounded-md border border-border-subtle bg-surface px-2 py-1.5 text-[13px] text-txt-primary"
              data-testid="export-project-select"
            >
              <option value="">All projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.identifier})
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-1.5 text-[12px] text-txt-secondary">
            <input
              type="checkbox"
              checked={includeReviews}
              onChange={(e) => setIncludeReviews(e.target.checked)}
              data-testid="export-include-reviews"
            />
            Reviews
          </label>

          <label className="flex items-center gap-1.5 text-[12px] text-txt-secondary">
            <input
              type="checkbox"
              checked={includeEvidence}
              onChange={(e) => setIncludeEvidence(e.target.checked)}
              data-testid="export-include-evidence"
            />
            Evidence
          </label>

          <Button
            type="button"
            onClick={generate}
            disabled={busy}
            data-testid="export-generate-btn"
          >
            {busy ? "Generating…" : "Generate"}
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-txt-tertiary">
          <span>{byteLength} bytes</span>
          <span>·</span>
          <span>{projectIds.length} project(s)</span>
        </div>
      </div>

      <div className="rounded-md border border-border-subtle bg-surface-1 p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[12px] font-semibold text-txt-primary">Preview</div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="neutral"
              size="sm"
              onClick={() => void copyMarkdown()}
              data-testid="export-copy-btn"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "copied" : "copy"}
            </Button>
            <Button
              type="button"
              variant="neutral"
              size="sm"
              onClick={downloadMarkdown}
              data-testid="export-download-btn"
            >
              <Download className="h-3.5 w-3.5" />
              download
            </Button>
          </div>
        </div>
        <pre
          className="max-h-[640px] overflow-auto rounded-md border border-border-subtle bg-surface p-3 font-mono-app text-[12px] leading-[1.5] text-txt-primary"
          data-testid="export-markdown-preview"
        >
{markdown}
        </pre>
      </div>
    </div>
  );
}

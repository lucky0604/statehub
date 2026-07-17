"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Loader2,
  History,
} from "lucide-react";
import type {
  Integration,
  ImportJob,
  GithubIssue,
  PlaneIssue,
  LinearIssue,
  ImportPreview,
  ImportRunResult,
} from "@statehub/domain";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api-client";

/**
 * Issues import wizard — supports any import-capable integration
 * (github, plane, linear). The server dispatches to the right importer
 * based on the integration's provider; the wizard just collects the
 * issue JSON in the provider's shape.
 *
 * Step 1: pick integration + project + state + paste issues JSON
 * Step 2: preview → see toCreate / toSkip / errors
 * Step 3: run → execute import → show created / skipped / errors
 *
 * Below the wizard: a history of recent import_jobs.
 *
 * Source: agent_flow/implementation/v1/phases/phase-06-import-integration.md §5
 */
interface Props {
  workspaceId: string;
  integrations: Integration[];
  projects: Array<{ id: string; name: string; identifier: string }>;
  states: Array<{ id: string; name: string; projectId: string }>;
  initialJobs: ImportJob[];
}

/** Providers that can import (markdown is export-only). */
const IMPORT_PROVIDERS = ["github", "plane", "linear"] as const;

const SAMPLE_GITHUB: GithubIssue[] = [
  {
    number: 101,
    title: "Bug: sample issue",
    body: "Sample description for the issue.",
    state: "open",
    html_url: "https://github.com/statehub/core/issues/101",
    labels: ["bug"],
    user: { login: "alice" },
  },
  {
    number: 102,
    title: "Feature: another sample",
    body: "Sample feature request.",
    state: "open",
    html_url: "https://github.com/statehub/core/issues/102",
    labels: ["enhancement"],
    user: { login: "bob" },
  },
];

const SAMPLE_PLANE: PlaneIssue[] = [
  {
    id: "plane-uuid-101",
    name: "DEMO-101",
    description: "Sample Plane issue.",
    state: "In Progress",
    priority: "high",
    project: "Demo",
    link: "https://plane.example/demo/projects/demo/issues/DEMO-101",
    labels: ["bug"],
    assignees: ["alice"],
  },
  {
    id: "plane-uuid-102",
    name: "DEMO-102",
    description: "Another sample.",
    state: "Backlog",
    priority: "medium",
    project: "Demo",
    link: "https://plane.example/demo/projects/demo/issues/DEMO-102",
    labels: ["feature"],
  },
];

const SAMPLE_LINEAR: LinearIssue[] = [
  {
    id: "linear-uuid-101",
    identifier: "DEMO-101",
    title: "Ship the thing",
    description: "Sample Linear issue.",
    state: { name: "In Progress", type: "started" },
    priority: 1,
    team: { id: "t1", name: "Demo", key: "DEMO" },
    project: { id: "p1", name: "Q1" },
    labels: { nodes: [{ id: "l1", name: "bug" }] },
    assignee: { name: "alice" },
    url: "https://linear.example/issue/DEMO-101",
  },
  {
    id: "linear-uuid-102",
    identifier: "DEMO-102",
    title: "Another one",
    description: "Another sample.",
    state: { name: "Backlog", type: "backlog" },
    priority: 2,
    team: { id: "t1", name: "Demo", key: "DEMO" },
    url: "https://linear.example/issue/DEMO-102",
  },
];

function sampleForProvider(provider: string | undefined): unknown[] {
  if (provider === "plane") return SAMPLE_PLANE;
  if (provider === "linear") return SAMPLE_LINEAR;
  return SAMPLE_GITHUB;
}

/**
 * Numeric prefix for an issue. GitHub issues carry a numeric `issueNumber`
 * (rendered as `#101`); Plane/Linear issues use a string identifier in
 * their title and set `issueNumber` to 0, so we render no prefix.
 */
function numPrefix(issueNumber: number): string {
  return issueNumber > 0 ? `#${issueNumber} ` : "";
}

export function ImportWizard({
  workspaceId,
  integrations,
  projects,
  states,
  initialJobs,
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const importIntegrations = integrations.filter((i) =>
    (IMPORT_PROVIDERS as readonly string[]).includes(i.provider),
  );

  const [integrationId, setIntegrationId] = useState(
    importIntegrations[0]?.id ?? "",
  );
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [stateId, setStateId] = useState("");
  const [issuesJson, setIssuesJson] = useState(
    JSON.stringify(sampleForProvider(importIntegrations[0]?.provider), null, 2),
  );
  const [jsonError, setJsonError] = useState<string | null>(null);

  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [result, setResult] = useState<ImportRunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [jobs, setJobs] = useState<ImportJob[]>(initialJobs);

  const selectedIntegration = importIntegrations.find((i) => i.id === integrationId);
  const selectedProvider = selectedIntegration?.provider;

  // Default stateId to first state of the selected project.
  useEffect(() => {
    if (stateId) return;
    const firstState = states.find((s) => s.projectId === projectId);
    if (firstState) setStateId(firstState.id);
  }, [projectId, states, stateId]);

  const projectStates = states.filter((s) => s.projectId === projectId);

  function parsedIssues(): unknown[] | null {
    setJsonError(null);
    try {
      const parsed = JSON.parse(issuesJson);
      if (!Array.isArray(parsed)) {
        setJsonError("JSON must be an array of issues");
        return null;
      }
      return parsed;
    } catch (err) {
      setJsonError(err instanceof Error ? err.message : "Invalid JSON");
      return null;
    }
  }

  async function doPreview() {
    setError(null);
    setResult(null);
    setPreview(null);
    if (!integrationId) {
      setError("Pick an integration first.");
      return;
    }
    if (!projectId || !stateId) {
      setError("Pick a target project + state.");
      return;
    }
    const issues = parsedIssues();
    if (!issues) return;

    setPreviewing(true);
    try {
      const res = await api.post<{ preview: ImportPreview }>(
        `/api/workspaces/${workspaceId}/integrations/${integrationId}/import/preview`,
        { project_id: projectId, state_id: stateId, issues },
      );
      setPreview(res.preview);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Preview failed");
    } finally {
      setPreviewing(false);
    }
  }

  async function doRun() {
    setError(null);
    setResult(null);
    if (!integrationId || !projectId || !stateId) {
      setError("Missing integration / project / state.");
      return;
    }
    const issues = parsedIssues();
    if (!issues) return;

    setRunning(true);
    try {
      const res = await api.post<{ job_id: string; result: ImportRunResult }>(
        `/api/workspaces/${workspaceId}/integrations/${integrationId}/import/run`,
        { project_id: projectId, state_id: stateId, issues },
      );
      setResult(res.result);
      // Refresh the jobs list.
      const jobsRes = await api.get<{ jobs: ImportJob[] }>(
        `/api/workspaces/${workspaceId}/import-jobs?integration_id=${integrationId}`,
      );
      setJobs(jobsRes.jobs);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Import run failed");
    } finally {
      setRunning(false);
    }
  }

  function loadSample() {
    setIssuesJson(JSON.stringify(sampleForProvider(selectedProvider), null, 2));
    setJsonError(null);
  }

  const hasNoIntegrations = importIntegrations.length === 0;

  return (
    <div className="space-y-4" data-testid="import-wizard">
      {hasNoIntegrations ? (
        <div className="rounded-md border border-warning/40 bg-warning/5 px-4 py-3 text-[12px] text-txt-primary">
          No import-capable integrations yet (github, plane, or linear).{" "}
          <Link
            href={`/workspaces/${workspaceId}/settings/integrations`}
            className="text-accent-primary hover:underline"
          >
            Add one in Settings →
          </Link>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-[12px] text-danger">
          {error}
        </div>
      ) : null}

      <section
        className="rounded-md border border-border-subtle bg-surface-1 p-4"
        data-testid="import-step-1"
      >
        <h2 className="text-[14px] font-semibold text-txt-primary">
          Step 1 — Pick source + target
        </h2>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
          <label className="flex flex-col gap-1 text-[11px] text-txt-secondary">
            Integration
            <select
              value={integrationId}
              onChange={(e) => setIntegrationId(e.target.value)}
              disabled={hasNoIntegrations}
              className="rounded-md border border-border-subtle bg-surface px-2 py-1.5 text-[12px] text-txt-primary"
              data-testid="import-integration-select"
            >
              {importIntegrations.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.provider})
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-[11px] text-txt-secondary">
            Target project
            <select
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value);
                setStateId("");
              }}
              className="rounded-md border border-border-subtle bg-surface px-2 py-1.5 text-[12px] text-txt-primary"
              data-testid="import-project-select"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.identifier})
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-[11px] text-txt-secondary">
            Target state
            <select
              value={stateId}
              onChange={(e) => setStateId(e.target.value)}
              className="rounded-md border border-border-subtle bg-surface px-2 py-1.5 text-[12px] text-txt-primary"
              data-testid="import-state-select"
            >
              {projectStates.length === 0 ? (
                <option value="">(no states)</option>
              ) : (
                projectStates.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))
              )}
            </select>
          </label>
        </div>

        <div className="mt-3 flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <label className="text-[11px] text-txt-secondary" htmlFor="issues-json">
              Issues JSON (paste from {selectedProvider ?? "your provider"} API or export)
            </label>
            <button
              type="button"
              onClick={loadSample}
              className="text-[11px] text-accent-primary hover:underline"
              data-testid="import-load-sample"
            >
              Load sample
            </button>
          </div>
          <textarea
            id="issues-json"
            value={issuesJson}
            onChange={(e) => setIssuesJson(e.target.value)}
            rows={10}
            spellCheck={false}
            className="rounded-md border border-border-subtle bg-surface px-2 py-1.5 font-mono-app text-[11px] text-txt-primary"
            data-testid="import-issues-json"
          />
          {jsonError ? (
            <span className="text-[11px] text-danger">JSON error: {jsonError}</span>
          ) : null}
        </div>

        <div className="mt-3 flex justify-end">
          <Button
            type="button"
            onClick={() => void doPreview()}
            disabled={previewing || !integrationId || !projectId || !stateId}
            data-testid="import-preview-btn"
          >
            {previewing ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : (
              <ArrowRight className="mr-1 h-3.5 w-3.5" />
            )}
            Preview
          </Button>
        </div>
      </section>

      {preview ? (
        <section
          className="rounded-md border border-border-subtle bg-surface-1 p-4"
          data-testid="import-step-2"
        >
          <h2 className="text-[14px] font-semibold text-txt-primary">
            Step 2 — Preview ({preview.toCreate.length} to create, {preview.toSkip.length}{" "}
            to skip, {preview.errors.length} errors)
          </h2>

          {preview.toCreate.length > 0 ? (
            <div className="mt-3">
              <div className="text-[12px] font-semibold text-txt-secondary">
                Will be created:
              </div>
              <ul className="mt-1 space-y-1" data-testid="import-preview-create">
                {preview.toCreate.map((c, idx) => (
                  <li
                    key={`${c.issueNumber}-${idx}`}
                    className="rounded-md border border-border-subtle bg-surface px-2 py-1 text-[12px]"
                    data-testid="import-preview-create-row"
                  >
                    <span className="font-mono-app text-txt-tertiary">
                      {numPrefix(c.issueNumber)}
                    </span>
                    <span className="text-txt-primary">{c.workItemTitle}</span>
                    {c.featureName ? (
                      <span className="ml-2 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-txt-secondary">
                        → {c.featureName}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {preview.toSkip.length > 0 ? (
            <div className="mt-3">
              <div className="text-[12px] font-semibold text-txt-secondary">
                Already linked (will be skipped):
              </div>
              <ul className="mt-1 space-y-1" data-testid="import-preview-skip">
                {preview.toSkip.map((s, idx) => (
                  <li
                    key={`${s.issueNumber}-${idx}`}
                    className="rounded-md border border-border-subtle bg-surface px-2 py-1 text-[12px] text-txt-tertiary"
                  >
                    <span className="font-mono-app">{numPrefix(s.issueNumber)}</span>
                    {s.issueTitle}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {preview.errors.length > 0 ? (
            <div className="mt-3">
              <div className="text-[12px] font-semibold text-danger">
                Errors (will be skipped):
              </div>
              <ul className="mt-1 space-y-1" data-testid="import-preview-errors">
                {preview.errors.map((e, idx) => (
                  <li
                    key={`${e.issueNumber}-${idx}`}
                    className="rounded-md border border-danger/30 bg-danger/5 px-2 py-1 text-[12px] text-danger"
                  >
                    <span className="font-mono-app">{numPrefix(e.issueNumber)}</span> {e.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-3 flex justify-end">
            <Button
              type="button"
              onClick={() => void doRun()}
              disabled={running || preview.toCreate.length === 0}
              data-testid="import-run-btn"
            >
              {running ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
              )}
              Run import ({preview.toCreate.length})
            </Button>
          </div>
        </section>
      ) : null}

      {result ? (
        <section
          className="rounded-md border border-border-subtle bg-surface-1 p-4"
          data-testid="import-step-3"
        >
          <h2 className="text-[14px] font-semibold text-txt-primary">
            Step 3 — Result ({result.created.length} created, {result.skipped.length}{" "}
            skipped, {result.errors.length} errors)
          </h2>
          <div className="mt-2 text-[12px] text-txt-secondary">
            Job ID:{" "}
            <span className="font-mono-app text-txt-tertiary" data-testid="import-result-job-id">
              {result.jobId}
            </span>
          </div>

          {result.created.length > 0 ? (
            <ul className="mt-2 space-y-1" data-testid="import-result-created">
              {result.created.map((c, idx) => (
                <li
                  key={`${c.issueNumber}-${idx}`}
                  className="flex items-center gap-2 rounded-md border border-border-subtle bg-surface px-2 py-1 text-[12px]"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                  <span className="font-mono-app text-txt-tertiary">{numPrefix(c.issueNumber)}</span>
                  <span className="text-txt-secondary">→ work item {c.workItemId.slice(0, 8)}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {result.errors.length > 0 ? (
            <ul className="mt-2 space-y-1" data-testid="import-result-errors">
              {result.errors.map((e, idx) => (
                <li
                  key={`${e.issueNumber}-${idx}`}
                  className="flex items-center gap-2 rounded-md border border-danger/30 bg-danger/5 px-2 py-1 text-[12px] text-danger"
                >
                  <XCircle className="h-3.5 w-3.5" />
                  <span className="font-mono-app">{numPrefix(e.issueNumber)}</span> {e.message}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      <section
        className="rounded-md border border-border-subtle bg-surface-1 p-4"
        data-testid="import-history"
      >
        <h2 className="flex items-center gap-2 text-[14px] font-semibold text-txt-primary">
          <History className="h-4 w-4 text-txt-tertiary" /> Import history
        </h2>
        {jobs.length === 0 ? (
          <div className="mt-2 text-[12px] text-txt-tertiary">No import jobs yet.</div>
        ) : (
          <ul className="mt-2 space-y-1" data-testid="import-job-list">
            {jobs.map((job) => {
              const summary = job.summaryJson
                ? (JSON.parse(job.summaryJson) as { created: number; skipped: number; errors: number })
                : null;
              return (
                <li
                  key={job.id}
                  className="flex flex-wrap items-center gap-2 rounded-md border border-border-subtle bg-surface px-2 py-1.5 text-[12px]"
                  data-testid="import-job-row"
                  data-job-id={job.id}
                >
                  {job.status === "completed" ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                  ) : job.status === "failed" ? (
                    <AlertCircle className="h-3.5 w-3.5 text-danger" />
                  ) : (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-txt-tertiary" />
                  )}
                  <span className="font-mono-app text-[11px] text-txt-tertiary">
                    {job.id.slice(0, 8)}
                  </span>
                  <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-txt-secondary">
                    {job.provider}
                  </span>
                  <span className="text-txt-secondary">{job.status}</span>
                  {summary ? (
                    <span className="text-txt-tertiary">
                      (created {summary.created}, skipped {summary.skipped}, errors {summary.errors})
                    </span>
                  ) : null}
                  <span className="ml-auto text-[11px] text-txt-tertiary">
                    {new Date(job.createdAt).toLocaleString()}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

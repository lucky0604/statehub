/**
 * record_test_command — record a test/lint/build command execution locally.
 *
 * Source: agent_flow/implementation/v1/phases/phase-04-local-mcp-sidecar.md §4
 *         agent_flow/implementation/v1/iterations/20260716-p04b-local-sidecar/plan.md §2.4
 *
 * This tool does NOT sync to remote. It returns the evidence_payload that the
 * agent should pass to sync_evidence (or use for its own logging). Separating
 * record from sync lets the agent attach extra context (feature_id, etc.)
 * before the network call.
 *
 * stdout/stderr summaries are truncated to 4KB to bound payload size.
 */
import { z } from "zod";
import { type ApiResult, ok, err } from "@statehub/shared";

export const recordTestCommandShape = {
  command: z.string().describe("The command that was executed, e.g. 'pnpm test'."),
  cwd: z.string().optional().describe("Working directory of the command. Defaults to the sidecar's cwd."),
  exit_code: z.number().int().describe("Process exit code. 0 = success."),
  duration_ms: z.number().int().min(0).describe("Wall-clock duration in milliseconds."),
  stdout_summary: z.string().optional().describe("Truncated stdout. Will be capped at 4KB."),
  stderr_summary: z.string().optional().describe("Truncated stderr. Will be capped at 4KB."),
};

export const recordTestCommandDescription =
  "Record a test/lint/build command execution (command, exit code, duration, stdout/stderr summaries). Does NOT sync to remote — pass the returned evidence_payload to sync_evidence to upload it.";

export interface RecordTestCommandArgs {
  command: string;
  cwd?: string;
  exit_code: number;
  duration_ms: number;
  stdout_summary?: string;
  stderr_summary?: string;
}

export interface RecordTestCommandData {
  recorded: true;
  evidence_payload: {
    evidence_type: "command";
    command: string;
    cwd: string;
    exit_code: number;
    duration_ms: number;
    stdout_summary?: string;
    stderr_summary?: string;
    success: boolean;
    recorded_at: number;
  };
}

const MAX_SUMMARY_BYTES = 4 * 1024;

function truncate(s: string): string {
  if (s.length <= MAX_SUMMARY_BYTES) return s;
  return s.slice(0, MAX_SUMMARY_BYTES) + "\n[truncated]";
}

export function recordTestCommand(args: RecordTestCommandArgs): ApiResult<RecordTestCommandData> {
  try {
    if (!args.command?.trim()) {
      return err("validation_error", "command is required");
    }
    if (!Number.isInteger(args.exit_code)) {
      return err("validation_error", "exit_code must be an integer");
    }
    if (args.duration_ms < 0 || !Number.isFinite(args.duration_ms)) {
      return err("validation_error", "duration_ms must be a non-negative finite number");
    }

    const payload: RecordTestCommandData["evidence_payload"] = {
      evidence_type: "command",
      command: args.command,
      cwd: args.cwd ?? process.cwd(),
      exit_code: args.exit_code,
      duration_ms: args.duration_ms,
      success: args.exit_code === 0,
      recorded_at: Date.now(),
    };
    if (args.stdout_summary) payload.stdout_summary = truncate(args.stdout_summary);
    if (args.stderr_summary) payload.stderr_summary = truncate(args.stderr_summary);

    return ok({ recorded: true, evidence_payload: payload });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err("internal_error", `record_test_command failed: ${msg}`);
  }
}

/**
 * Config loader — reads + validates .statehub/config.json from process.cwd()
 * (or --config path).
 *
 * Source: agent_flow/implementation/v1/phases/phase-04-local-mcp-sidecar.md §3
 *
 * The token is NEVER in this file — only the NAME of the env var that holds
 * it. Reading the env var happens in remote-client.ts at request time so a
 * long-running sidecar picks up rotated tokens without a restart.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface LocalConfig {
  remoteUrl: string;
  workspaceSlug: string;
  projectSlug: string;
  tokenEnv: string;
  repoAliases?: string[];
}

export class ConfigError extends Error {
  constructor(public field: string, message: string) {
    super(`config.${field}: ${message}`);
    this.name = "ConfigError";
  }
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}$/;
const ENV_RE = /^[A-Z_][A-Z0-9_]*$/;

/** Load and validate the config file. Throws ConfigError on any issue. */
export function loadConfig(configPath?: string): LocalConfig {
  const path = configPath ?? resolve(process.cwd(), ".statehub/config.json");
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new ConfigError("file", `could not read ${path}: ${msg}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new ConfigError("file", `invalid JSON: ${msg}`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ConfigError("file", "top-level value must be an object");
  }
  const o = parsed as Record<string, unknown>;

  if (typeof o.remoteUrl !== "string" || !o.remoteUrl) {
    throw new ConfigError("remoteUrl", "required string");
  }
  let remoteUrl: URL;
  try {
    remoteUrl = new URL(o.remoteUrl);
  } catch {
    throw new ConfigError("remoteUrl", "must be a valid http(s) URL");
  }
  if (remoteUrl.protocol !== "http:" && remoteUrl.protocol !== "https:") {
    throw new ConfigError("remoteUrl", "must be http or https");
  }

  if (typeof o.workspaceSlug !== "string" || !SLUG_RE.test(o.workspaceSlug)) {
    throw new ConfigError("workspaceSlug", "must be 2-39 chars, lowercase alphanumeric + hyphens");
  }
  if (typeof o.projectSlug !== "string" || !SLUG_RE.test(o.projectSlug)) {
    throw new ConfigError("projectSlug", "must be 2-39 chars, lowercase alphanumeric + hyphens");
  }
  if (typeof o.tokenEnv !== "string" || !ENV_RE.test(o.tokenEnv)) {
    throw new ConfigError("tokenEnv", "must be an uppercase env var name (A-Z, 0-9, _)");
  }
  if (o.repoAliases !== undefined && !Array.isArray(o.repoAliases)) {
    throw new ConfigError("repoAliases", "must be an array of strings if present");
  }
  if (Array.isArray(o.repoAliases)) {
    for (const a of o.repoAliases) {
      if (typeof a !== "string" || !a) {
        throw new ConfigError("repoAliases", "every entry must be a non-empty string");
      }
    }
  }

  return {
    remoteUrl: o.remoteUrl,
    workspaceSlug: o.workspaceSlug,
    projectSlug: o.projectSlug,
    tokenEnv: o.tokenEnv,
    repoAliases: Array.isArray(o.repoAliases) ? o.repoAliases : undefined,
  };
}

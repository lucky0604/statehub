/**
 * Git helpers — pure functions over child_process. All fail soft: if not a
 * git repo (or git is unavailable), return null fields rather than throwing.
 *
 * Source: agent_flow/implementation/v1/phases/phase-04-local-mcp-sidecar.md §4
 *         agent_flow/implementation/v1/iterations/20260716-p04b-local-sidecar/plan.md §2
 */
import { execFileSync } from "node:child_process";

export interface RepoContext {
  repoPath: string;
  repoRemoteUrl: string | null;
  gitBranch: string | null;
  baseSha: string | null;
  headSha: string | null;
  dirtyState: boolean;
  untrackedFiles: string[];
}

export interface DiffStat {
  filesChanged: number;
  insertions: number;
  deletions: number;
}

export interface LatestCommit {
  sha: string;
  author: string;
  message: string;
  timestamp: number;
}

function runGit(cwd: string, args: string[]): string | null {
  try {
    const out = execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
      timeout: 5000,
    });
    // Trim trailing whitespace only — leading spaces are significant in
    // `git status --porcelain` (the first column is the staged status, often
    // a space). A full trim would corrupt the parse.
    return out.replace(/\s+$/, "");
  } catch {
    return null;
  }
}

function isGitRepo(cwd: string): boolean {
  return runGit(cwd, ["rev-parse", "--is-inside-work-tree"]) === "true";
}

/** Find the default branch name (main or master). */
function defaultBranch(cwd: string): string | null {
  for (const candidate of ["main", "master"]) {
    if (runGit(cwd, ["rev-parse", "--verify", candidate])) return candidate;
  }
  return null;
}

export function getRepoContext(cwd: string = process.cwd()): RepoContext {
  if (!isGitRepo(cwd)) {
    return {
      repoPath: cwd,
      repoRemoteUrl: null,
      gitBranch: null,
      baseSha: null,
      headSha: null,
      dirtyState: false,
      untrackedFiles: [],
    };
  }

  const repoRemoteUrl = runGit(cwd, ["remote", "get-url", "origin"]);
  const gitBranch = runGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  const headSha = runGit(cwd, ["rev-parse", "HEAD"]);
  const defaultB = defaultBranch(cwd);
  const baseSha = defaultB ? runGit(cwd, ["merge-base", defaultB, "HEAD"]) : null;

  // Porcelain output: lines with ?? prefix are untracked, M/ A/ D/ etc. are tracked changes.
  const porcelain = runGit(cwd, ["status", "--porcelain"]) ?? "";
  const lines = porcelain.split("\n").filter(Boolean);
  const untrackedFiles = lines
    .filter((l) => l.startsWith("??"))
    .map((l) => l.slice(3).trim());
  const dirtyState = lines.length > 0;

  return {
    repoPath: cwd,
    repoRemoteUrl,
    gitBranch,
    baseSha,
    headSha,
    dirtyState,
    untrackedFiles,
  };
}

export function getChangedFiles(cwd: string = process.cwd()): string[] {
  const porcelain = runGit(cwd, ["status", "--porcelain"]) ?? "";
  return porcelain
    .split("\n")
    .filter(Boolean)
    .filter((l) => !l.startsWith("??"))
    .map((l) => l.slice(3).trim());
}

export function getUntrackedFiles(cwd: string = process.cwd()): string[] {
  const porcelain = runGit(cwd, ["status", "--porcelain"]) ?? "";
  return porcelain
    .split("\n")
    .filter(Boolean)
    .filter((l) => l.startsWith("??"))
    .map((l) => l.slice(3).trim());
}

export function getDiffStat(cwd: string = process.cwd()): DiffStat {
  // --shortstat emits "N file(s) changed, X insertions(+), Y deletions(-)".
  const out = runGit(cwd, ["diff", "--shortstat", "HEAD"]);
  if (!out) return { filesChanged: 0, insertions: 0, deletions: 0 };
  const filesMatch = /(\d+) files? changed/.exec(out);
  const insMatch = /(\d+) insertions?/.exec(out);
  const delMatch = /(\d+) deletions?/.exec(out);
  return {
    filesChanged: filesMatch ? Number(filesMatch[1]) : 0,
    insertions: insMatch ? Number(insMatch[1]) : 0,
    deletions: delMatch ? Number(delMatch[1]) : 0,
  };
}

export function getLatestCommit(cwd: string = process.cwd()): LatestCommit | null {
  // Format: sha<tab>author<tab>timestamp<tab>subject
  const line = runGit(cwd, [
    "log",
    "-1",
    "--pretty=format:%H\t%an\t%ct\t%s",
  ]);
  if (!line) return null;
  const [sha, author, ts, ...rest] = line.split("\t");
  if (!sha || !author || !ts) return null;
  return {
    sha,
    author,
    timestamp: Number(ts) * 1000,
    message: rest.join("\t"),
  };
}

/**
 * Optional: full diff text. NOT called by collect_git_evidence by default —
 * callers must opt in with include_diff=true. Exposed for tests + power
 * users who explicitly want the diff in the evidence payload.
 */
export function getFullDiff(cwd: string = process.cwd(), maxBytes = 64 * 1024): string | null {
  const out = runGit(cwd, ["diff", "HEAD"]);
  if (!out) return null;
  return out.length > maxBytes ? out.slice(0, maxBytes) + "\n[truncated]" : out;
}

/**
 * Tests for git helpers — exercises real git against a fixture repo created
 * in tmpdir per test. Fail-soft paths (no repo, no remote) also covered.
 *
 * Source: agent_flow/implementation/v1/iterations/20260716-p04b-local-sidecar/plan.md §4 (acceptance #2, #3)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  getRepoContext,
  getChangedFiles,
  getUntrackedFiles,
  getDiffStat,
  getLatestCommit,
  getFullDiff,
} from "../src/git";

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: ["pipe", "pipe", "ignore"] });
}

describe("git helpers", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mcp-local-git-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe("getRepoContext — non-repo path", () => {
    it("returns null fields when not a git repo", () => {
      const ctx = getRepoContext(dir);
      expect(ctx.repoPath).toBe(dir);
      expect(ctx.repoRemoteUrl).toBeNull();
      expect(ctx.gitBranch).toBeNull();
      expect(ctx.baseSha).toBeNull();
      expect(ctx.headSha).toBeNull();
      expect(ctx.dirtyState).toBe(false);
      expect(ctx.untrackedFiles).toEqual([]);
    });
  });

  describe("getRepoContext — fresh repo", () => {
    beforeEach(() => {
      git(dir, ["init", "--initial-branch=main"]);
      git(dir, ["config", "user.email", "test@example.com"]);
      git(dir, ["config", "user.name", "Test"]);
      git(dir, ["config", "commit.gpgsign", "false"]);
    });

    it("returns branch + head_sha after a commit", () => {
      writeFileSync(join(dir, "README.md"), "hello\n");
      git(dir, ["add", "README.md"]);
      git(dir, ["commit", "-m", "initial"]);

      const ctx = getRepoContext(dir);
      expect(ctx.gitBranch).toBe("main");
      expect(ctx.headSha).toMatch(/^[0-9a-f]{40}$/);
      expect(ctx.baseSha).toBe(ctx.headSha); // single commit on main
      expect(ctx.dirtyState).toBe(false);
      expect(ctx.untrackedFiles).toEqual([]);
    });

    it("detects dirty state from modified tracked file", () => {
      writeFileSync(join(dir, "README.md"), "hello\n");
      git(dir, ["add", "README.md"]);
      git(dir, ["commit", "-m", "initial"]);

      writeFileSync(join(dir, "README.md"), "changed\n");
      const ctx = getRepoContext(dir);
      expect(ctx.dirtyState).toBe(true);
      expect(ctx.untrackedFiles).toEqual([]);
    });

    it("detects untracked files", () => {
      writeFileSync(join(dir, "README.md"), "hello\n");
      git(dir, ["add", "README.md"]);
      git(dir, ["commit", "-m", "initial"]);

      writeFileSync(join(dir, "new.txt"), "untracked\n");
      const ctx = getRepoContext(dir);
      expect(ctx.dirtyState).toBe(true);
      expect(ctx.untrackedFiles).toEqual(["new.txt"]);
    });

    it("returns null remote URL when no remote is set", () => {
      writeFileSync(join(dir, "README.md"), "hello\n");
      git(dir, ["add", "README.md"]);
      git(dir, ["commit", "-m", "initial"]);

      const ctx = getRepoContext(dir);
      expect(ctx.repoRemoteUrl).toBeNull();
    });

    it("returns remote URL when origin is set", () => {
      git(dir, ["remote", "add", "origin", "git@github.com:owner/repo.git"]);
      writeFileSync(join(dir, "README.md"), "hello\n");
      git(dir, ["add", "README.md"]);
      git(dir, ["commit", "-m", "initial"]);

      const ctx = getRepoContext(dir);
      expect(ctx.repoRemoteUrl).toBe("git@github.com:owner/repo.git");
    });
  });

  describe("getChangedFiles / getUntrackedFiles / getDiffStat", () => {
    beforeEach(() => {
      git(dir, ["init", "--initial-branch=main"]);
      git(dir, ["config", "user.email", "test@example.com"]);
      git(dir, ["config", "user.name", "Test"]);
      git(dir, ["config", "commit.gpgsign", "false"]);
      writeFileSync(join(dir, "README.md"), "hello\n");
      git(dir, ["add", "README.md"]);
      git(dir, ["commit", "-m", "initial"]);
    });

    it("getChangedFiles excludes untracked, includes modified", () => {
      writeFileSync(join(dir, "README.md"), "changed\n");
      writeFileSync(join(dir, "new.txt"), "new\n");
      expect(getChangedFiles(dir)).toEqual(["README.md"]);
      expect(getUntrackedFiles(dir)).toEqual(["new.txt"]);
    });

    it("getDiffStat reports insertions", () => {
      writeFileSync(join(dir, "README.md"), "line1\nline2\nline3\n");
      const stat = getDiffStat(dir);
      expect(stat.filesChanged).toBeGreaterThanOrEqual(1);
      expect(stat.insertions).toBeGreaterThan(0);
    });

    it("getDiffStat is zero on clean tree", () => {
      const stat = getDiffStat(dir);
      expect(stat.filesChanged).toBe(0);
      expect(stat.insertions).toBe(0);
      expect(stat.deletions).toBe(0);
    });

    it("dirty_state clears after git stash (acceptance #3)", () => {
      writeFileSync(join(dir, "README.md"), "changed\n");
      expect(getRepoContext(dir).dirtyState).toBe(true);

      git(dir, ["stash"]);
      expect(getRepoContext(dir).dirtyState).toBe(false);

      git(dir, ["stash", "pop"]);
      expect(getRepoContext(dir).dirtyState).toBe(true);
    });
  });

  describe("getLatestCommit", () => {
    beforeEach(() => {
      git(dir, ["init", "--initial-branch=main"]);
      git(dir, ["config", "user.email", "test@example.com"]);
      git(dir, ["config", "user.name", "Test"]);
      git(dir, ["config", "commit.gpgsign", "false"]);
    });

    it("returns null when there are no commits", () => {
      expect(getLatestCommit(dir)).toBeNull();
    });

    it("returns sha, author, message, timestamp after a commit", () => {
      writeFileSync(join(dir, "file.txt"), "x\n");
      git(dir, ["add", "file.txt"]);
      git(dir, ["commit", "-m", "test commit message"]);

      const c = getLatestCommit(dir);
      expect(c).not.toBeNull();
      expect(c!.sha).toMatch(/^[0-9a-f]{40}$/);
      expect(c!.author).toBe("Test");
      expect(c!.message).toBe("test commit message");
      expect(c!.timestamp).toBeGreaterThan(0);
    });
  });

  describe("getFullDiff", () => {
    beforeEach(() => {
      git(dir, ["init", "--initial-branch=main"]);
      git(dir, ["config", "user.email", "test@example.com"]);
      git(dir, ["config", "user.name", "Test"]);
      git(dir, ["config", "commit.gpgsign", "false"]);
      writeFileSync(join(dir, "README.md"), "hello\n");
      git(dir, ["add", "README.md"]);
      git(dir, ["commit", "-m", "initial"]);
    });

    it("returns null on clean tree", () => {
      expect(getFullDiff(dir)).toBeNull();
    });

    it("returns diff text on dirty tree", () => {
      writeFileSync(join(dir, "README.md"), "changed\n");
      const diff = getFullDiff(dir);
      expect(diff).not.toBeNull();
      expect(diff).toContain("README.md");
      expect(diff).toContain("-hello");
      expect(diff).toContain("+changed");
    });

    it("truncates at maxBytes", () => {
      // Create a large uncommitted change.
      mkdirSync(join(dir, "data"), { recursive: true });
      const big = "x".repeat(100_000);
      writeFileSync(join(dir, "data", "big.txt"), big);
      git(dir, ["add", "data/big.txt"]);

      const diff = getFullDiff(dir, 1024);
      expect(diff).not.toBeNull();
      expect(diff!.length).toBeLessThan(big.length);
      expect(diff).toContain("[truncated]");
    });
  });
});

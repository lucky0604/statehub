/**
 * Tests for config loader — validation + error messages.
 *
 * Source: agent_flow/implementation/v1/iterations/20260716-p04b-local-sidecar/plan.md §2.1, §4 (acceptance #7)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, ConfigError } from "../src/config";

describe("config loader", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mcp-local-cfg-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeConfig(obj: unknown): string {
    const cfgDir = join(dir, ".statehub");
    mkdirSync(cfgDir, { recursive: true });
    const path = join(cfgDir, "config.json");
    writeFileSync(path, JSON.stringify(obj));
    return path;
  }

  it("loads a valid config", () => {
    const path = writeConfig({
      remoteUrl: "http://localhost:3000",
      workspaceSlug: "personal",
      projectSlug: "kavis",
      tokenEnv: "STATEHUB_TOKEN",
      repoAliases: ["git@github.com:owner/kavis.git"],
    });
    const cfg = loadConfig(path);
    expect(cfg.remoteUrl).toBe("http://localhost:3000");
    expect(cfg.workspaceSlug).toBe("personal");
    expect(cfg.projectSlug).toBe("kavis");
    expect(cfg.tokenEnv).toBe("STATEHUB_TOKEN");
    expect(cfg.repoAliases).toEqual(["git@github.com:owner/kavis.git"]);
  });

  it("accepts config without repoAliases", () => {
    const path = writeConfig({
      remoteUrl: "https://statehub.example.com",
      workspaceSlug: "personal",
      projectSlug: "kavis",
      tokenEnv: "STATEHUB_TOKEN",
    });
    const cfg = loadConfig(path);
    expect(cfg.repoAliases).toBeUndefined();
  });

  it("throws ConfigError when file is missing", () => {
    expect(() => loadConfig(join(dir, "nope.json"))).toThrow(ConfigError);
    try {
      loadConfig(join(dir, "nope.json"));
    } catch (e) {
      expect(e instanceof ConfigError && e.field).toBe("file");
    }
  });

  it("throws ConfigError on invalid JSON", () => {
    const cfgDir = join(dir, ".statehub");
    mkdirSync(cfgDir, { recursive: true });
    const path = join(cfgDir, "config.json");
    writeFileSync(path, "{not json");
    expect(() => loadConfig(path)).toThrow(ConfigError);
  });

  it("throws ConfigError when remoteUrl is not a URL", () => {
    const path = writeConfig({
      remoteUrl: "not-a-url",
      workspaceSlug: "personal",
      projectSlug: "kavis",
      tokenEnv: "STATEHUB_TOKEN",
    });
    try {
      loadConfig(path);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e instanceof ConfigError && e.field).toBe("remoteUrl");
    }
  });

  it("throws ConfigError when remoteUrl is not http(s)", () => {
    const path = writeConfig({
      remoteUrl: "ftp://example.com",
      workspaceSlug: "personal",
      projectSlug: "kavis",
      tokenEnv: "STATEHUB_TOKEN",
    });
    try {
      loadConfig(path);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e instanceof ConfigError && e.field).toBe("remoteUrl");
    }
  });

  it("throws ConfigError on invalid workspaceSlug", () => {
    const path = writeConfig({
      remoteUrl: "http://localhost:3000",
      workspaceSlug: "Personal", // uppercase rejected
      projectSlug: "kavis",
      tokenEnv: "STATEHUB_TOKEN",
    });
    try {
      loadConfig(path);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e instanceof ConfigError && e.field).toBe("workspaceSlug");
    }
  });

  it("throws ConfigError on invalid projectSlug", () => {
    const path = writeConfig({
      remoteUrl: "http://localhost:3000",
      workspaceSlug: "personal",
      projectSlug: "x", // too short (min 2 chars)
      tokenEnv: "STATEHUB_TOKEN",
    });
    try {
      loadConfig(path);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e instanceof ConfigError && e.field).toBe("projectSlug");
    }
  });

  it("throws ConfigError on invalid tokenEnv", () => {
    const path = writeConfig({
      remoteUrl: "http://localhost:3000",
      workspaceSlug: "personal",
      projectSlug: "kavis",
      tokenEnv: "statehub_token", // lowercase rejected
    });
    try {
      loadConfig(path);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e instanceof ConfigError && e.field).toBe("tokenEnv");
    }
  });

  it("throws ConfigError when repoAliases is not an array", () => {
    const path = writeConfig({
      remoteUrl: "http://localhost:3000",
      workspaceSlug: "personal",
      projectSlug: "kavis",
      tokenEnv: "STATEHUB_TOKEN",
      repoAliases: "not-an-array",
    });
    try {
      loadConfig(path);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e instanceof ConfigError && e.field).toBe("repoAliases");
    }
  });

  it("throws ConfigError when a repoAlias is empty", () => {
    const path = writeConfig({
      remoteUrl: "http://localhost:3000",
      workspaceSlug: "personal",
      projectSlug: "kavis",
      tokenEnv: "STATEHUB_TOKEN",
      repoAliases: ["valid", ""],
    });
    try {
      loadConfig(path);
      throw new Error("should have thrown");
    } catch (e) {
      expect(e instanceof ConfigError && e.field).toBe("repoAliases");
    }
  });
});

#!/usr/bin/env node
// bin.mjs — thin wrapper so `mcp-local` (when installed) runs the TypeScript
// source via tsx. In a workspace context, agents invoke
// `pnpm --filter @statehub/mcp-local dev` instead — this wrapper exists for
// standalone installs.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, "src", "index.ts");

// Resolve tsx relative to this package's node_modules, falling back to PATH.
const localTsx = join(here, "node_modules", ".bin", "tsx");
const tsxBin = existsSync(localTsx) ? localTsx : "tsx";

const child = spawn(tsxBin, [entry, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});
child.on("error", (e) => {
  process.stderr.write(`[mcp-local] failed to spawn tsx: ${e.message}\n`);
  process.exit(1);
});
child.on("exit", (code) => process.exit(code ?? 0));

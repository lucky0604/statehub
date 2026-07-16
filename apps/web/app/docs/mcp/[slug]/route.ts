import { notFound } from "next/navigation";
import path from "node:path";
import { readFile, stat } from "node:fs/promises";

/**
 * /docs/mcp/* — serves the markdown docs from the repo-root /docs/mcp directory
 * as text/plain so the in-app Settings page can deep-link to them.
 *
 * Source: agent_flow/implementation/v1/iterations/20260715-p02c-agent-sync-ui-docs/plan.md §3
 *
 * P02C serves raw markdown — rendering to HTML is a later polish. The links
 * from the Settings page use target="_blank" so this opens in a new tab.
 */
const DOCS_ROOT = path.resolve(process.cwd(), "..", "..", "docs", "mcp");
const ALLOWED = new Set(["opencode-setup.md", "codex-setup.md", "tool-reference.md", "first-sync.md"]);

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  if (!ALLOWED.has(slug)) notFound();

  const filePath = path.join(DOCS_ROOT, slug);
  // Defense in depth: resolve and confirm the path is still under DOCS_ROOT.
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(DOCS_ROOT + path.sep)) notFound();

  try {
    const s = await stat(resolved);
    if (!s.isFile()) notFound();
  } catch {
    notFound();
  }

  const body = await readFile(resolved, "utf8");
  return new Response(body, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/**
 * normalizeRepoUrl — collapse equivalent git remote URLs to a single canonical
 * form so a project's `repo_url` and any of its aliases can be matched against
 * whatever the local sidecar happens to report.
 *
 * Rules:
 *   - strip a trailing ".git"
 *   - strip a trailing "/"
 *   - lowercase the host (case-insensitive on GitHub etc.)
 *   - convert git@github.com:owner/repo → https://github.com/owner/repo
 *   - keep the path case as-is (GitHub treats owner/repo as case-insensitive
 *     for public repos, but case-sensitive paths can exist; we keep the
 *     user's spelling rather than guess)
 *
 * Returns the input lowercased if it doesn't look like a URL (defensive).
 */
export function normalizeRepoUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;

  // ssh form: git@github.com:owner/repo[.git]
  const sshMatch = /^git@([^:]+):(.+)$/.exec(trimmed);
  if (sshMatch) {
    const host = sshMatch[1]!.toLowerCase();
    let path = sshMatch[2]!;
    if (path.endsWith(".git")) path = path.slice(0, -4);
    if (path.endsWith("/")) path = path.slice(0, -1);
    return `https://${host}/${path}`;
  }

  // ssh form: ssh://git@github.com/owner/repo[.git]
  const sshSlashMatch = /^ssh:\/\/(?:[^@]+@)?([^/]+)\/(.+)$/.exec(trimmed);
  if (sshSlashMatch) {
    const host = sshSlashMatch[1]!.toLowerCase();
    let path = sshSlashMatch[2]!;
    if (path.endsWith(".git")) path = path.slice(0, -4);
    if (path.endsWith("/")) path = path.slice(0, -1);
    return `https://${host}/${path}`;
  }

  // http(s) form
  try {
    const url = new URL(trimmed);
    const host = url.host.toLowerCase();
    let path = url.pathname;
    if (path.endsWith(".git")) path = path.slice(0, -4);
    if (path.endsWith("/") && path !== "/") path = path.slice(0, -1);
    return `https://${host}${path}`;
  } catch {
    return trimmed.toLowerCase();
  }
}

/**
 * App layout — wraps every authenticated route in the AppShell.
 *
 * Source: P08B — split out from the root layout so /login can render
 * without the AppShell chrome.
 *
 * `force-dynamic` because every app route reads from D1 via AppShell
 * (workspace switcher) at minimum. Without this, Next.js tries to
 * statically prerender `/_not-found`, which evaluates AppShell, which
 * calls db(), which calls getCloudflareContext() — and sync mode is
 * not allowed during static prerender.
 */
import { AppShell } from "@/components/app-shell";

export const dynamic = "force-dynamic";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}

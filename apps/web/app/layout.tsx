import type { Metadata } from "next";

import { AppShell } from "@/components/app-shell";
import { ThemeProvider } from "@/lib/theme-provider";
import "@/styles/globals.css";

// StateHub has no truly static pages — every route reads from D1 via
// AppShell (workspace switcher) at minimum. Force dynamic rendering so
// `getCloudflareContext()` (sync, request-scoped) is available
// everywhere. Without this, Next.js tries to statically prerender
// `/_not-found`, which evaluates AppShell, which calls db(), which
// calls getCloudflareContext() — and sync mode is not allowed during
// static prerender.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "StateHub",
  description:
    "AI-native project manager for solo builders. Turns coding agent work into structured project state.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <AppShell>{children}</AppShell>
        </ThemeProvider>
      </body>
    </html>
  );
}

import type { Metadata } from "next";

import { AppShell } from "@/components/app-shell";
import { ThemeProvider } from "@/lib/theme-provider";
import "@/styles/globals.css";

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

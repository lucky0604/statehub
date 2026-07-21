"use client";

import { useState } from "react";

/**
 * Logout button — clears the session cookie and redirects to /login.
 *
 * Source: agent_flow/implementation/v1/iterations/20260719-p08b-basic-auth/plan.md §3.13
 */
export function LogoutButton() {
  const [busy, setBusy] = useState(false);

  async function onLogout() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "/login";
    }
  }

  return (
    <button
      type="button"
      onClick={onLogout}
      disabled={busy}
      className="rounded border border-border-subtle px-2 py-1 text-[12px] text-txt-secondary hover:bg-layer-2 disabled:opacity-50"
    >
      {busy ? "…" : "Sign out"}
    </button>
  );
}

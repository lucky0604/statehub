"use client";

import { useState } from "react";

/**
 * Login form — posts to /api/auth/login, then redirects to ?next= or /.
 *
 * Source: agent_flow/implementation/v1/iterations/20260719-p08b-basic-auth/plan.md §3.8
 */
export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const message = body?.error?.message ?? "Login failed";
        setError(message);
        return;
      }
      const next = new URLSearchParams(window.location.search).get("next") ?? "/";
      window.location.href = next;
    } catch {
      setError("Network error — please try again");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-surface p-6 shadow-sm"
    >
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">StateHub</h1>
        <p className="text-sm text-muted">Sign in to your workspace</p>
      </div>

      {error && (
        <div className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <label className="block space-y-1">
        <span className="text-sm font-medium">Email</span>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded border border-border bg-canvas px-3 py-2 text-sm outline-none focus:border-primary"
        />
      </label>

      <label className="block space-y-1">
        <span className="text-sm font-medium">Password</span>
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded border border-border bg-canvas px-3 py-2 text-sm outline-none focus:border-primary"
        />
      </label>

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {submitting ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

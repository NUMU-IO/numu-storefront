"use client";

import { useState } from "react";

/**
 * Client-side password-gate form.
 *
 * Posts JSON to /api/storefront/unlock and on 204 navigates to the
 * pre-supplied `next` URL via window.location (full reload, so the
 * layout re-runs with the freshly-set unlock cookie).
 */
export function PasswordForm({ next }: { next: string }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/storefront/unlock", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.status === 204) {
        // Hard reload so the server-rendered layout sees the new cookie.
        window.location.href = next || "/";
        return;
      }
      const json = await res.json().catch(() => null);
      setError(json?.error || "Incorrect password.");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <label className="block text-sm font-medium text-gray-700">
        Password
        <input
          type="password"
          autoFocus
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-black"
        />
      </label>
      {error ? (
        <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-2">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={loading || !password}
        className="w-full rounded-md bg-black px-4 py-2 text-white text-sm font-medium disabled:opacity-50"
      >
        {loading ? "Checking…" : "Enter"}
      </button>
    </form>
  );
}

"use client";

import { useState } from "react";

interface Balance {
  last_four: string;
  current_balance_cents: number;
  currency: string;
  expires_at: string | null;
}

export default function GiftCardCheckClient() {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setBalance(null);
    try {
      const res = await fetch(
        `/api/gift-cards/${encodeURIComponent(code.trim())}`,
        { cache: "no-store" },
      );
      if (!res.ok) {
        setError(
          res.status === 404
            ? "That gift card isn't valid or has been used up."
            : `Couldn't check the card (HTTP ${res.status}).`,
        );
        return;
      }
      const json = await res.json();
      const data = json?.data;
      if (data) setBalance(data as Balance);
      else setError("Unexpected response from the server.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't check the card.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-2">Gift cards</h1>
      <p className="text-gray-600 mb-6">
        Check the remaining balance on a gift card you&apos;ve received.
        Apply it at checkout to pay for any order.
      </p>
      <form onSubmit={check} className="flex gap-2">
        <input
          type="text"
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="GC-XXXX-XXXX-XXXX-XXXX"
          className="flex-1 border rounded px-3 py-2 text-sm font-mono"
          aria-label="Gift card code"
          disabled={busy}
        />
        <button
          type="submit"
          disabled={busy || !code.trim()}
          className="bg-black text-white px-4 rounded hover:bg-gray-800 disabled:opacity-50"
        >
          {busy ? "Checking…" : "Check balance"}
        </button>
      </form>

      {error && (
        <p className="mt-4 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      {balance && (
        <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm text-gray-600">Gift card •••{balance.last_four}</p>
          <p className="text-3xl font-semibold mt-1">
            {(balance.current_balance_cents / 100).toFixed(2)} {balance.currency}
          </p>
          {balance.expires_at && (
            <p className="text-xs text-gray-500 mt-2">
              Expires {new Date(balance.expires_at).toLocaleDateString()}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

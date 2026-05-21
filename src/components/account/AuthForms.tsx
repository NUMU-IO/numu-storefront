"use client";

/**
 * Built-in account auth form fallbacks.
 *
 * These render only when the active theme is a built-in (no BYOT bundle
 * with an `account` template). For BYOT, the bundle owns the rendering
 * and posts to the same `/api/customer/*` proxies — these forms are a
 * floor, not a ceiling.
 *
 * Why client-side: form submission needs the `numu_csrf` cookie value
 * read from `document.cookie`. Doing it on the server would require
 * ferrying the CSRF token through React props which is fiddly and
 * also wouldn't survive a page that renders cached.
 */

import { useState } from "react";

const inputCls =
  "block w-full rounded-md border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-black";
const buttonCls =
  "w-full rounded-md bg-black px-4 py-2 text-white font-medium disabled:opacity-50";
const errorCls = "rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-800";
const okCls = "rounded-md bg-green-50 border border-green-200 p-3 text-sm text-green-800";

function readCsrf(): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|; )numu_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

async function postJson(
  path: string,
  body: unknown,
): Promise<{ ok: boolean; status: number; payload: any }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const csrf = readCsrf();
  if (csrf) headers["x-numu-csrf"] = csrf;
  const res = await fetch(path, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers,
    body: JSON.stringify(body),
  });
  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    /* empty body — fine */
  }
  return { ok: res.ok, status: res.status, payload };
}

function extractError(payload: any, fallback: string): string {
  if (!payload) return fallback;
  // FastAPI shape: { success: false, error: { message: "..." } }
  // OR validation: { detail: [...] } / { detail: "..." }
  if (payload.error?.message) return String(payload.error.message);
  if (typeof payload.detail === "string") return payload.detail;
  if (Array.isArray(payload.detail) && payload.detail[0]?.msg)
    return String(payload.detail[0].msg);
  return fallback;
}

// ── Login ────────────────────────────────────────────────────────────────────

export function LoginForm({ redirectTo = "/account" }: { redirectTo?: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const r = await postJson("/api/customer/login", { email, password });
    setBusy(false);
    if (r.ok) {
      window.location.href = redirectTo;
      return;
    }
    setErr(extractError(r.payload, "Login failed. Check your email + password."));
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {err && <div className={errorCls}>{err}</div>}
      <div>
        <label className="text-sm font-medium block mb-1">Email</label>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputCls}
        />
      </div>
      <div>
        <label className="text-sm font-medium block mb-1">Password</label>
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputCls}
        />
      </div>
      <button type="submit" disabled={busy} className={buttonCls}>
        {busy ? "Signing in…" : "Sign in"}
      </button>
      <div className="text-sm text-gray-600 flex justify-between">
        <a href="/account/recover" className="hover:underline">
          Forgot password?
        </a>
        <a href="/account/register" className="hover:underline">
          Create account →
        </a>
      </div>
    </form>
  );
}

// ── Register ─────────────────────────────────────────────────────────────────

export function RegisterForm({ redirectTo = "/account" }: { redirectTo?: string }) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [accepts, setAccepts] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const r = await postJson("/api/customer/register", {
      first_name: firstName,
      last_name: lastName,
      email,
      phone: phone || undefined,
      password,
      accepts_marketing: accepts,
    });
    setBusy(false);
    if (r.ok) {
      window.location.href = redirectTo;
      return;
    }
    setErr(extractError(r.payload, "Registration failed."));
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {err && <div className={errorCls}>{err}</div>}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium block mb-1">First name</label>
          <input
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            autoComplete="given-name"
            className={inputCls}
          />
        </div>
        <div>
          <label className="text-sm font-medium block mb-1">Last name</label>
          <input
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            autoComplete="family-name"
            className={inputCls}
          />
        </div>
      </div>
      <div>
        <label className="text-sm font-medium block mb-1">Email</label>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputCls}
        />
      </div>
      <div>
        <label className="text-sm font-medium block mb-1">
          Phone <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <input
          type="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className={inputCls}
        />
      </div>
      <div>
        <label className="text-sm font-medium block mb-1">Password</label>
        <input
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputCls}
        />
        <p className="text-xs text-gray-500 mt-1">At least 8 characters.</p>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={accepts}
          onChange={(e) => setAccepts(e.target.checked)}
        />
        <span>Send me marketing emails about new products and offers.</span>
      </label>
      <button type="submit" disabled={busy} className={buttonCls}>
        {busy ? "Creating account…" : "Create account"}
      </button>
      <div className="text-sm text-gray-600 text-center">
        Already have an account?{" "}
        <a href="/account/login" className="hover:underline font-medium">
          Sign in
        </a>
      </div>
    </form>
  );
}

// ── Recover ──────────────────────────────────────────────────────────────────

export function RecoverForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const r = await postJson("/api/customer/recover", { email });
    setBusy(false);
    if (r.ok) {
      setSent(true);
      return;
    }
    setErr(extractError(r.payload, "Could not start recovery."));
  }

  if (sent) {
    return (
      <div className={okCls}>
        If an account exists for <strong>{email}</strong>, a reset link is on
        its way.
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {err && <div className={errorCls}>{err}</div>}
      <div>
        <label className="text-sm font-medium block mb-1">Email</label>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputCls}
        />
      </div>
      <button type="submit" disabled={busy} className={buttonCls}>
        {busy ? "Sending…" : "Send reset link"}
      </button>
      <div className="text-sm text-gray-600 text-center">
        <a href="/account/login" className="hover:underline">
          ← Back to sign in
        </a>
      </div>
    </form>
  );
}

// ── Reset ────────────────────────────────────────────────────────────────────

export function ResetForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setErr("Passwords don't match.");
      return;
    }
    setBusy(true);
    setErr(null);
    const r = await postJson("/api/customer/reset", { token, password });
    setBusy(false);
    if (r.ok) {
      setDone(true);
      return;
    }
    setErr(extractError(r.payload, "Reset failed. Token may be invalid or expired."));
  }

  if (done) {
    return (
      <div className="space-y-4">
        <div className={okCls}>
          Password reset. You can now sign in with the new password.
        </div>
        <a href="/account/login" className={buttonCls + " inline-block text-center"}>
          Sign in
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {err && <div className={errorCls}>{err}</div>}
      <div>
        <label className="text-sm font-medium block mb-1">New password</label>
        <input
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputCls}
        />
      </div>
      <div>
        <label className="text-sm font-medium block mb-1">Confirm new password</label>
        <input
          type="password"
          required
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={inputCls}
        />
      </div>
      <button type="submit" disabled={busy} className={buttonCls}>
        {busy ? "Resetting…" : "Reset password"}
      </button>
    </form>
  );
}

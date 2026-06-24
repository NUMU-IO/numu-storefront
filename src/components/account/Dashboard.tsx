"use client";

/**
 * Built-in account dashboard components — orders list, addresses,
 * profile editor, and the account home shell.
 *
 * These render only when the active theme is a built-in (no BYOT
 * bundle with `account` templates). For BYOT, the bundle reads
 * `page.data.{customer,orders,addresses}` and renders its own UI.
 *
 * The dashboard pages all hydrate from the SSR-fetched customer data
 * passed via the `initial*` props — that means the user lands on a
 * fully-rendered page with no flicker, then the component takes over
 * for any client-side mutations.
 */

import { useState } from "react";
import ReorderButton from "@/components/account/ReorderButton";

const inputCls =
  "block w-full rounded-[var(--numu-radius)] border border-[var(--numu-border)] bg-[var(--numu-surface)] px-3 py-2 text-[var(--numu-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--numu-navy)]/30 focus:border-[var(--numu-navy)]";
const buttonCls =
  "numu-btn-navy rounded-full px-5 py-2 text-sm font-semibold disabled:opacity-50";
const ghostBtn =
  "rounded-full border border-[var(--numu-border)] bg-[var(--numu-surface)] px-4 py-1.5 text-sm font-medium text-[var(--numu-ink)] hover:bg-[var(--numu-cream)] disabled:opacity-50";
const errorCls =
  "rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-800";
const okCls =
  "rounded-md bg-green-50 border border-green-200 p-3 text-sm text-green-800";

function readCsrf(): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|; )numu_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

async function send(
  path: string,
  method: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; payload: any }> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const csrf = readCsrf();
  if (csrf && method !== "GET") headers["x-numu-csrf"] = csrf;
  const res = await fetch(path, {
    method,
    credentials: "include",
    cache: "no-store",
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    /* empty body */
  }
  return { ok: res.ok, status: res.status, payload };
}

function unwrap(p: any) {
  return p?.data ?? p;
}

// ── Layout helper ───────────────────────────────────────────────────────────

function AccountFrame({
  customer,
  active,
  children,
}: {
  customer: any;
  active: "home" | "orders" | "addresses" | "profile";
  children: React.ReactNode;
}) {
  const name =
    [customer?.first_name, customer?.last_name].filter(Boolean).join(" ") ||
    customer?.email ||
    "Account";

  const tabs: { key: typeof active; label: string; href: string }[] = [
    { key: "home", label: "Overview", href: "/account" },
    { key: "orders", label: "Orders", href: "/account/orders" },
    { key: "addresses", label: "Addresses", href: "/account/addresses" },
    { key: "profile", label: "Profile", href: "/account/profile" },
  ];

  async function logout() {
    await send("/api/customer/logout", "POST", {});
    window.location.href = "/account/login";
  }

  return (
    <main className="min-h-screen bg-[var(--numu-paper)] px-4 py-12 [font-family:var(--numu-sans)]">
      <div className="max-w-4xl mx-auto space-y-8">
        <header className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-[var(--numu-ink)] [font-family:var(--numu-display)]">
              {name}
            </h1>
            {customer?.email && (
              <p className="text-sm text-[var(--numu-ink-soft)] mt-0.5">{customer.email}</p>
            )}
          </div>
          <button onClick={logout} className={ghostBtn}>
            Sign out
          </button>
        </header>
        <nav className="flex gap-1 border-b border-[var(--numu-border)] -mb-px overflow-x-auto">
          {tabs.map((t) => (
            <a
              key={t.key}
              href={t.href}
              className={
                "px-3 py-2 text-sm font-medium border-b-2 -mb-px " +
                (t.key === active
                  ? "border-[var(--numu-navy)] text-[var(--numu-navy)]"
                  : "border-transparent text-[var(--numu-ink-soft)] hover:text-[var(--numu-navy)]")
              }
            >
              {t.label}
            </a>
          ))}
        </nav>
        <div>{children}</div>
      </div>
    </main>
  );
}

// ── Account home ────────────────────────────────────────────────────────────

export function AccountHome({
  customer,
  recentOrders,
}: {
  customer: any;
  recentOrders: any[];
}) {
  return (
    <AccountFrame customer={customer} active="home">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section className="rounded-lg border border-[var(--numu-border)] p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--numu-ink-soft)] mb-3">
            Recent orders
          </h2>
          {recentOrders.length === 0 ? (
            <p className="text-sm text-[var(--numu-ink-soft)]">No orders yet.</p>
          ) : (
            <ul className="space-y-2">
              {recentOrders.slice(0, 3).map((o: any) => (
                <li key={o.id} className="text-sm">
                  <a
                    href={`/account/orders/${o.id}`}
                    className="hover:underline"
                  >
                    <strong>#{o.order_number || o.id.slice(0, 8)}</strong>
                    {" — "}
                    <span className="text-[var(--numu-ink-soft)]">
                      {o.status} · {o.total} {o.currency}
                    </span>
                  </a>
                </li>
              ))}
              {recentOrders.length > 3 && (
                <li className="text-sm">
                  <a href="/account/orders" className="text-[var(--numu-ink-soft)] hover:underline">
                    See all orders →
                  </a>
                </li>
              )}
            </ul>
          )}
        </section>
        <section className="rounded-lg border border-[var(--numu-border)] p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--numu-ink-soft)] mb-3">
            Account
          </h2>
          <ul className="space-y-2 text-sm">
            <li>
              <a href="/account/addresses" className="hover:underline">
                Saved addresses
              </a>
            </li>
            <li>
              <a href="/account/profile" className="hover:underline">
                Edit profile
              </a>
            </li>
          </ul>
        </section>
      </div>
    </AccountFrame>
  );
}

// ── Orders list ─────────────────────────────────────────────────────────────

export function OrdersList({
  customer,
  initialOrders,
}: {
  customer: any;
  initialOrders: any[];
}) {
  return (
    <AccountFrame customer={customer} active="orders">
      <h2 className="text-lg font-semibold mb-4">Order history</h2>
      {initialOrders.length === 0 ? (
        <p className="text-sm text-[var(--numu-ink-soft)]">No orders yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--numu-border)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--numu-cream)] text-left">
              <tr>
                <th className="px-4 py-2 font-medium">Order</th>
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {initialOrders.map((o: any) => (
                <tr key={o.id}>
                  <td className="px-4 py-3">
                    <a
                      href={`/account/orders/${o.id}`}
                      className="font-medium hover:underline"
                    >
                      #{o.order_number || o.id.slice(0, 8)}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-[var(--numu-ink-soft)]">
                    {o.created_at
                      ? new Date(o.created_at).toLocaleDateString()
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-[var(--numu-ink-soft)]">{o.status}</td>
                  <td className="px-4 py-3">
                    {o.total} {o.currency}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AccountFrame>
  );
}

// ── Order detail ────────────────────────────────────────────────────────────

export function OrderDetail({
  customer,
  order,
}: {
  customer: any;
  order: any;
}) {
  if (!order) {
    return (
      <AccountFrame customer={customer} active="orders">
        <div className="text-sm text-[var(--numu-ink-soft)]">
          Order not found.{" "}
          <a href="/account/orders" className="hover:underline">
            ← Back to orders
          </a>
        </div>
      </AccountFrame>
    );
  }
  const items: any[] = order.line_items || [];
  return (
    <AccountFrame customer={customer} active="orders">
      <a
        href="/account/orders"
        className="text-sm text-[var(--numu-ink-soft)] hover:underline inline-block mb-4"
      >
        ← Back to orders
      </a>
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-lg font-semibold">
            Order #{order.order_number || order.id?.slice(0, 8)}
          </h2>
          <span className="text-sm text-[var(--numu-ink-soft)]">
            {order.created_at
              ? new Date(order.created_at).toLocaleString()
              : ""}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div>
            <div className="text-[var(--numu-ink-soft)] text-xs uppercase">Status</div>
            <div className="font-medium">{order.status}</div>
          </div>
          <div>
            <div className="text-[var(--numu-ink-soft)] text-xs uppercase">Payment</div>
            <div className="font-medium">{order.payment_status}</div>
          </div>
          <div>
            <div className="text-[var(--numu-ink-soft)] text-xs uppercase">Fulfillment</div>
            <div className="font-medium">{order.fulfillment_status || "—"}</div>
          </div>
        </div>
        <div className="rounded-lg border border-[var(--numu-border)] divide-y">
          {items.map((it: any, i: number) => (
            <div key={i} className="p-4 flex justify-between gap-4 text-sm">
              <div>
                <div className="font-medium">
                  {it.product_name || it.name || "Item"}
                </div>
                {it.variant_label && (
                  <div className="text-[var(--numu-ink-soft)] text-xs mt-0.5">
                    {it.variant_label}
                  </div>
                )}
                <div className="text-[var(--numu-ink-soft)] text-xs mt-0.5">
                  Qty {it.quantity}
                </div>
              </div>
              <div className="text-right font-medium">
                {(it.unit_price * it.quantity) / 100} {order.currency}
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-between text-sm pt-2 border-t border-[var(--numu-border)]">
          <span className="text-[var(--numu-ink-soft)]">Total</span>
          <span className="font-bold text-base">
            {order.total} {order.currency}
          </span>
        </div>
        <div>
          <ReorderButton orderId={order.id} />
        </div>
      </div>
    </AccountFrame>
  );
}

// ── Addresses ───────────────────────────────────────────────────────────────

interface Address {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
  phone?: string | null;
  is_default?: boolean;
}

export function AddressesPage({
  customer,
  initialAddresses,
}: {
  customer: any;
  initialAddresses: Address[];
}) {
  const [addresses, setAddresses] = useState<Address[]>(initialAddresses);
  const [editing, setEditing] = useState<Address | null>(null);
  const [adding, setAdding] = useState(false);

  async function refresh() {
    const r = await send("/api/customer/me/addresses", "GET");
    if (r.ok) {
      const data = unwrap(r.payload);
      setAddresses(Array.isArray(data) ? data : data?.items ?? []);
    }
  }

  async function save(input: Partial<Address>, id?: string) {
    if (id) {
      await send(`/api/customer/me/addresses/${id}`, "PUT", input);
    } else {
      await send("/api/customer/me/addresses", "POST", input);
    }
    setEditing(null);
    setAdding(false);
    await refresh();
  }
  async function remove(id: string) {
    if (!confirm("Remove this address?")) return;
    await send(`/api/customer/me/addresses/${id}`, "DELETE");
    await refresh();
  }
  async function setDefault(id: string) {
    await send(`/api/customer/me/addresses/${id}/default`, "PUT");
    await refresh();
  }

  return (
    <AccountFrame customer={customer} active="addresses">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Saved addresses</h2>
        {!adding && !editing && (
          <button onClick={() => setAdding(true)} className={buttonCls}>
            Add address
          </button>
        )}
      </div>
      {(adding || editing) && (
        <AddressForm
          initial={editing ?? undefined}
          onSave={(input) => save(input, editing?.id)}
          onCancel={() => {
            setAdding(false);
            setEditing(null);
          }}
        />
      )}
      {!adding && !editing && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {addresses.length === 0 ? (
            <p className="text-sm text-[var(--numu-ink-soft)]">No saved addresses yet.</p>
          ) : (
            addresses.map((a) => (
              <div
                key={a.id}
                className="rounded-lg border border-[var(--numu-border)] p-4 text-sm space-y-2"
              >
                <div className="font-medium">
                  {[a.first_name, a.last_name].filter(Boolean).join(" ") || "—"}
                  {a.is_default && (
                    <span className="ml-2 text-xs rounded-full bg-[var(--numu-navy)] text-white px-2 py-0.5 align-middle">
                      Default
                    </span>
                  )}
                </div>
                <div className="text-[var(--numu-ink-soft)]">
                  {a.address_line1}
                  {a.address_line2 ? ", " + a.address_line2 : ""}
                  <br />
                  {[a.city, a.state, a.postal_code].filter(Boolean).join(", ")}
                  <br />
                  {a.country}
                </div>
                {a.phone && <div className="text-[var(--numu-ink-soft)]">{a.phone}</div>}
                <div className="flex gap-2 pt-2 flex-wrap">
                  <button onClick={() => setEditing(a)} className={ghostBtn}>
                    Edit
                  </button>
                  {!a.is_default && (
                    <button onClick={() => setDefault(a.id)} className={ghostBtn}>
                      Set default
                    </button>
                  )}
                  <button
                    onClick={() => remove(a.id)}
                    className={ghostBtn + " text-red-700 hover:bg-red-50"}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </AccountFrame>
  );
}

function AddressForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Address;
  onSave: (input: Partial<Address>) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<Partial<Address>>({
    first_name: initial?.first_name ?? "",
    last_name: initial?.last_name ?? "",
    address_line1: initial?.address_line1 ?? "",
    address_line2: initial?.address_line2 ?? "",
    city: initial?.city ?? "",
    state: initial?.state ?? "",
    postal_code: initial?.postal_code ?? "",
    country: initial?.country ?? "EG",
    phone: initial?.phone ?? "",
    is_default: initial?.is_default ?? false,
  });
  const [busy, setBusy] = useState(false);
  function set<K extends keyof Address>(key: K, value: Address[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }
  return (
    <form
      className="rounded-lg border border-[var(--numu-border)] p-5 space-y-4 mb-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await onSave(form);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name" value={form.first_name ?? ""} onChange={(v) => set("first_name", v)} />
        <Field label="Last name" value={form.last_name ?? ""} onChange={(v) => set("last_name", v)} />
      </div>
      <Field
        label="Address line 1"
        value={form.address_line1 ?? ""}
        onChange={(v) => set("address_line1", v)}
        required
      />
      <Field
        label="Address line 2 (optional)"
        value={form.address_line2 ?? ""}
        onChange={(v) => set("address_line2", v)}
      />
      <div className="grid grid-cols-2 gap-3">
        <Field label="City" value={form.city ?? ""} onChange={(v) => set("city", v)} required />
        <Field label="Governorate / State" value={form.state ?? ""} onChange={(v) => set("state", v)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Postal code" value={form.postal_code ?? ""} onChange={(v) => set("postal_code", v)} />
        <Field label="Country (ISO)" value={form.country ?? "EG"} onChange={(v) => set("country", v)} required />
      </div>
      <Field label="Phone" value={form.phone ?? ""} onChange={(v) => set("phone", v)} />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={!!form.is_default}
          onChange={(e) => set("is_default", e.target.checked)}
        />
        <span>Set as default address</span>
      </label>
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={buttonCls}>
          {busy ? "Saving…" : "Save address"}
        </button>
        <button type="button" onClick={onCancel} className={ghostBtn}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  return (
    <div>
      <label className="text-sm font-medium block mb-1">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className={inputCls}
      />
    </div>
  );
}

// ── Profile ─────────────────────────────────────────────────────────────────

export function ProfilePage({ customer }: { customer: any }) {
  const [first, setFirst] = useState(customer?.first_name ?? "");
  const [last, setLast] = useState(customer?.last_name ?? "");
  const [phone, setPhone] = useState(customer?.phone ?? "");
  const [marketing, setMarketing] = useState(
    customer?.accepts_marketing ?? false,
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setSaved(false);
    const r = await send("/api/customer/me", "PUT", {
      first_name: first,
      last_name: last,
      phone,
      accepts_marketing: marketing,
    });
    setBusy(false);
    if (!r.ok) {
      setErr(r.payload?.error?.message || "Update failed.");
      return;
    }
    setSaved(true);
  }

  // Password change
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [pwOk, setPwOk] = useState(false);

  async function changePw(e: React.FormEvent) {
    e.preventDefault();
    setPwBusy(true);
    setPwErr(null);
    setPwOk(false);
    const r = await send("/api/customer/me/password", "PUT", {
      current_password: currentPw,
      new_password: newPw,
    });
    setPwBusy(false);
    if (!r.ok) {
      setPwErr(r.payload?.error?.message || "Password change failed.");
      return;
    }
    setPwOk(true);
    setCurrentPw("");
    setNewPw("");
  }

  return (
    <AccountFrame customer={customer} active="profile">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <form onSubmit={submit} className="space-y-4">
          <h2 className="text-lg font-semibold">Personal info</h2>
          {err && <div className={errorCls}>{err}</div>}
          {saved && <div className={okCls}>Profile saved.</div>}
          <Field label="First name" value={first} onChange={setFirst} />
          <Field label="Last name" value={last} onChange={setLast} />
          <Field label="Phone" value={phone} onChange={setPhone} />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={marketing}
              onChange={(e) => setMarketing(e.target.checked)}
            />
            <span>Receive marketing emails.</span>
          </label>
          <button type="submit" disabled={busy} className={buttonCls}>
            {busy ? "Saving…" : "Save profile"}
          </button>
        </form>
        <form onSubmit={changePw} className="space-y-4">
          <h2 className="text-lg font-semibold">Change password</h2>
          {pwErr && <div className={errorCls}>{pwErr}</div>}
          {pwOk && <div className={okCls}>Password updated.</div>}
          <div>
            <label className="text-sm font-medium block mb-1">
              Current password
            </label>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">
              New password
            </label>
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              className={inputCls}
            />
          </div>
          <button type="submit" disabled={pwBusy} className={buttonCls}>
            {pwBusy ? "Updating…" : "Update password"}
          </button>
        </form>
      </div>
    </AccountFrame>
  );
}

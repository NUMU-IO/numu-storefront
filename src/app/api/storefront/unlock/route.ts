import { NextRequest, NextResponse } from "next/server";
import { fetchStoreByHost } from "@/lib/api-client";

const API_URL = process.env.NUMU_API_URL || "http://localhost:8021/api/v1";
import {
  UNLOCK_COOKIE,
  readPasswordProtection,
  unlockToken,
} from "@/lib/store-lock";

/**
 * POST /api/storefront/unlock — ask the API to verify the visitor's
 * password, then set the unlock cookie on success.
 *
 * The comparison used to happen HERE, against a `password_hash` the public
 * `/store-by-subdomain` endpoint handed out — so the hash was readable by
 * anyone who could guess a subdomain. Verification moved server-side to the
 * API; this route now only relays the answer and mints a cookie from a
 * secret the browser never sees.
 *
 * Resolves the store by the proxy-stamped `x-numu-host` header (or
 * the raw host) — same lookup the rest of the storefront uses. We
 * never trust a `store_id` in the request body; the visitor doesn't
 * know it and the cookie is bound to the host, not the body.
 *
 * On success: 204 with the cookie set, scoped to "/" so every page
 * sees it. On failure: 401 with no cookie (and no leak about whether
 * the password was wrong vs. the store doesn't have a password set).
 */
export async function POST(req: NextRequest) {
  const host =
    req.headers.get("x-numu-host") ||
    (req.headers.get("host") || "").split(":")[0];
  if (!host) {
    return NextResponse.json(
      { error: "Host header missing." },
      { status: 400 },
    );
  }

  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }
  const plain = typeof body?.password === "string" ? body.password : "";
  if (!plain) {
    return NextResponse.json(
      { error: "Password is required." },
      { status: 400 },
    );
  }

  let store: any;
  try {
    store = await fetchStoreByHost(host);
  } catch {
    return NextResponse.json({ error: "Store not found." }, { status: 404 });
  }

  const protection = readPasswordProtection(store);
  if (!protection || !protection.hasPassword || !store?.id) {
    // No password set — nothing to unlock. Return 401 (rather than 200)
    // to keep the response shape uniform: a misconfigured visitor never
    // gets a cookie when there's no protection in effect.
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  // The API owns the comparison; it answers with a bare boolean and never
  // returns the hash, so a wrong guess teaches the caller nothing.
  let verified = false;
  try {
    const res = await fetch(
      `${API_URL}/storefront/store-by-subdomain/${encodeURIComponent(
        String(store.subdomain || "").toLowerCase(),
      )}/verify-password`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: plain }),
        cache: "no-store",
      },
    );
    if (res.ok) {
      const json = (await res.json()) as { data?: { verified?: boolean } };
      verified = json?.data?.verified === true;
    }
  } catch {
    // Upstream unreachable — fail CLOSED. The gate exists to keep an
    // unlaunched store private; degrading it open would defeat the point.
    verified = false;
  }
  if (!verified) {
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  const res = new NextResponse(null, { status: 204 });
  // 7-day unlock window — a returning visitor doesn't have to re-enter
  // for a week. The merchant can rotate the password to invalidate all
  // outstanding cookies (the stored hash changes → no cookie matches).
  res.cookies.set(UNLOCK_COOKIE, unlockToken(String(store.id)), {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure:
      req.nextUrl.protocol === "https:" ||
      req.headers.get("x-forwarded-proto") === "https",
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}

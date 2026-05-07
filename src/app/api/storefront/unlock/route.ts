import { NextRequest, NextResponse } from "next/server";
import { fetchStoreByHost } from "@/lib/api-client";
import {
  UNLOCK_COOKIE,
  hashPassword,
  hashesMatch,
  readPasswordProtection,
} from "@/lib/store-lock";

/**
 * POST /api/storefront/unlock — verify the visitor's password against
 * the store's `password_protected.password_hash` and set the unlock
 * cookie on success.
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
  if (!protection || !protection.password_hash) {
    // No password set — nothing to unlock. Return 401 (rather than 200)
    // to keep the response shape uniform: a misconfigured visitor never
    // gets a cookie when there's no protection in effect.
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  const submitted = hashPassword(plain);
  if (!hashesMatch(submitted, protection.password_hash)) {
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  const res = new NextResponse(null, { status: 204 });
  // 7-day unlock window — a returning visitor doesn't have to re-enter
  // for a week. The merchant can rotate the password to invalidate all
  // outstanding cookies (the stored hash changes → no cookie matches).
  res.cookies.set(UNLOCK_COOKIE, protection.password_hash, {
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

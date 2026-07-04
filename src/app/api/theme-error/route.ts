import { NextRequest, NextResponse } from "next/server";
import { fetchStoreByHost, fetchStoreByDomain } from "@/lib/api-client";

/**
 * POST /api/theme-error — shopper-side theme telemetry ingest.
 *
 * The BYOT theme boundary and the route error boundary fire a
 * `navigator.sendBeacon` here when a theme bundle fails to load or throws
 * during render on a real shopper's page. We log it as a single-line ERROR to
 * stdout — prod ships stdout to CloudWatch — AND best-effort forward it to the
 * backend ingest (`/storefront/store/{id}/theme-error`) so crashes persist
 * beyond the CloudWatch retention window and surface in the merchant hub.
 *
 * Contract (all fields optional / best-effort):
 *   { store, bundleUrl, message, stack?, url?, themeSlug?, themeVersion? }
 *
 * Defensive by construction: it never throws, caps the body it reads, and
 * always answers 204 so a misbehaving (or hostile) beacon can't error the
 * ingest path or become an amplification vector.
 */

// Beacons here are tiny (store + url + message + short stack). Anything larger
// is malformed or hostile — don't buffer it.
const MAX_BODY_BYTES = 16 * 1024;

// Keep individual fields short in the log line.
const MAX_FIELD_LEN = 2_000;

const API_URL = process.env.NUMU_API_URL || "http://localhost:8021/api/v1";

function clip(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0
    ? value.slice(0, MAX_FIELD_LEN)
    : undefined;
}

/**
 * Best-effort persistence: forward the beacon to the backend theme-error
 * ingest. Resolves the store from the request host (mirrors cart-track), with
 * the beacon's own `store` subdomain as a fallback. Never throws; bounded by a
 * 5s timeout so a stalled backend can't hold the serverless invocation open.
 */
async function forwardThemeError(
  req: NextRequest,
  parsed: Record<string, unknown>,
): Promise<void> {
  const message = clip(parsed.message);
  // The backend requires a message; without one there's nothing to persist.
  if (!message) return;

  // Resolve the store id — same pattern as /api/storefront/cart-track.
  const host =
    req.headers.get("x-numu-host") ||
    (req.headers.get("host") || "").split(":")[0];
  let store: { id?: string } | null = null;
  try {
    if (host) store = await fetchStoreByHost(host);
  } catch {
    store = null;
  }
  // Fallback: the beacon carries the store subdomain (error.tsx derives it from
  // the hostname), which resolves even when the host header didn't (e.g. dev
  // path-based routing where the host is the platform apex).
  if (!store?.id) {
    const bodyStore = typeof parsed.store === "string" ? parsed.store : "";
    if (bodyStore) {
      try {
        store = await fetchStoreByDomain(bodyStore);
      } catch {
        store = null;
      }
    }
  }
  if (!store?.id) return;

  // Map the (camelCase) beacon fields onto the backend's snake_case contract.
  const payload: Record<string, string> = { message };
  const bundleUrl = clip(parsed.bundleUrl) ?? clip(parsed.bundle_url);
  const url = clip(parsed.url);
  const themeSlug = clip(parsed.themeSlug) ?? clip(parsed.theme_slug);
  const themeVersion = clip(parsed.themeVersion) ?? clip(parsed.theme_version);
  if (bundleUrl) payload.bundle_url = bundleUrl;
  if (url) payload.url = url;
  if (themeSlug) payload.theme_slug = themeSlug;
  if (themeVersion) payload.theme_version = themeVersion;

  await fetch(`${API_URL}/storefront/store/${store.id}/theme-error`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
}

export async function POST(req: NextRequest) {
  let parsed: Record<string, unknown> | null = null;
  try {
    // Reject oversized bodies up front, without reading them.
    const declared = Number(req.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return new NextResponse(null, { status: 204 });
    }

    const raw = await req.text();
    const body =
      raw.length > MAX_BODY_BYTES ? raw.slice(0, MAX_BODY_BYTES) : raw;

    try {
      parsed = JSON.parse(body) as Record<string, unknown>;
    } catch {
      // Non-JSON beacon — log the raw (clipped) text as the message.
      parsed = { message: body };
    }

    // Single-line structured ERROR so CloudWatch Insights can filter on
    // `kind = "theme_error"` and group by store / bundleUrl.
    console.error(
      "[theme-error]",
      JSON.stringify({
        kind: "theme_error",
        store: clip(parsed.store),
        bundleUrl: clip(parsed.bundleUrl),
        message: clip(parsed.message),
        url: clip(parsed.url),
        stack: clip(parsed.stack),
        themeSlug: clip(parsed.themeSlug),
        themeVersion: clip(parsed.themeVersion),
      }),
    );
  } catch {
    // Telemetry ingest must never throw — swallow everything.
  }

  // Best-effort backend persistence. Separate try so a forward failure can
  // never affect the log line above or the 204 below.
  if (parsed) {
    try {
      await forwardThemeError(req, parsed);
    } catch {
      /* best-effort — never throw */
    }
  }

  return new NextResponse(null, { status: 204 });
}

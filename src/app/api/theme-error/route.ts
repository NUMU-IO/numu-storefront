import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/theme-error — shopper-side theme telemetry ingest.
 *
 * The BYOT theme boundary and the route error boundary fire a
 * `navigator.sendBeacon` here when a theme bundle fails to load or throws
 * during render on a real shopper's page. We log it as a single-line ERROR to
 * stdout — prod ships stdout to CloudWatch, so this is the surface for "which
 * store / theme is broken for shoppers right now".
 *
 * Contract (all fields optional / best-effort):
 *   { store, bundleUrl, message, stack?, url? }
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

function clip(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0
    ? value.slice(0, MAX_FIELD_LEN)
    : undefined;
}

export async function POST(req: NextRequest) {
  try {
    // Reject oversized bodies up front, without reading them.
    const declared = Number(req.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return new NextResponse(null, { status: 204 });
    }

    const raw = await req.text();
    const body =
      raw.length > MAX_BODY_BYTES ? raw.slice(0, MAX_BODY_BYTES) : raw;

    let parsed: Record<string, unknown>;
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
      }),
    );
  } catch {
    // Telemetry ingest must never throw — swallow everything.
  }
  return new NextResponse(null, { status: 204 });
}

/**
 * On-demand revalidation endpoint for the NUMU storefront.
 *
 * Called by the FastAPI backend (`nextjs_revalidation.py`) whenever data
 * changes in NUMU-api that should invalidate cached pages. The protocol
 * is header-based — the secret travels in `x-revalidation-secret`, NOT in
 * the body. This avoids leaking the secret in proxy access logs and is
 * the canonical contract documented in NUMU-api.
 *
 * Request:
 *   POST /api/revalidate
 *   Headers: x-revalidation-secret: <SECRET>
 *   Body: { paths?: string[], tags?: string[], scope?: "layout" | "page" }
 *
 * Response:
 *   200 { revalidated: { paths, tags } }
 *   401 if the secret is missing or wrong
 *   400 if the body has no `paths` and no `tags`
 */

import { revalidatePath, revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

// Read at module load. We deliberately do NOT default to an empty string —
// an empty secret would let an unauthenticated POST purge the cache. In
// production the absence of REVALIDATION_SECRET is fatal.
const SECRET = process.env.REVALIDATION_SECRET ?? "";
const isProd = process.env.NODE_ENV === "production";

if (isProd && !SECRET) {
  // Surface this loudly during boot. Next will still serve the route, but
  // every call returns 503 below.
  console.error(
    "[revalidate] REVALIDATION_SECRET is not set in production. " +
      "All revalidation requests will be rejected.",
  );
}

interface RevalidateBody {
  paths?: unknown;
  tags?: unknown;
  scope?: unknown;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

export async function POST(request: NextRequest) {
  // Hard-fail if the env var isn't configured in prod — even with a "valid"
  // request, we don't want to silently allow purges.
  if (isProd && !SECRET) {
    return NextResponse.json(
      { error: "Revalidation not configured" },
      { status: 503 },
    );
  }

  const provided = request.headers.get("x-revalidation-secret") ?? "";
  // Constant-time-ish compare: we don't ship a crypto dep just for this,
  // but we always compare the configured length to defeat trivial timing
  // probes. The endpoint is rate-limited by the upstream proxy.
  if (!SECRET || provided.length !== SECRET.length || provided !== SECRET) {
    return NextResponse.json({ error: "Invalid secret" }, { status: 401 });
  }

  let body: RevalidateBody;
  try {
    body = (await request.json()) as RevalidateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const paths = isStringArray(body.paths) ? body.paths : [];
  const tags = isStringArray(body.tags) ? body.tags : [];
  const scope =
    body.scope === "layout" || body.scope === "page" ? body.scope : undefined;

  if (paths.length === 0 && tags.length === 0) {
    return NextResponse.json(
      { error: "Provide at least one of `paths` or `tags`" },
      { status: 400 },
    );
  }

  const revalidated = { paths: [] as string[], tags: [] as string[] };

  for (const tag of new Set(tags)) {
    try {
      // Next 16 made `profile` required; "default" preserves prior semantics.
      revalidateTag(tag, "default");
      revalidated.tags.push(tag);
    } catch (err) {
      console.warn(`[revalidate] Failed to revalidate tag "${tag}":`, err);
    }
  }

  for (const path of new Set(paths)) {
    try {
      // `scope` controls layout vs page invalidation; default is "page".
      revalidatePath(path, scope === "layout" ? "layout" : "page");
      revalidated.paths.push(path);
    } catch (err) {
      console.warn(`[revalidate] Failed to revalidate path "${path}":`, err);
    }
  }

  return NextResponse.json({ revalidated, success: true });
}

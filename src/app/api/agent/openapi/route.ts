/**
 * OpenAPI description of the storefront's PUBLIC read API — served at
 * `/openapi.json` (rewritten here by `proxy.ts`).
 *
 * The finding this closes is narrow and real: `/openapi.json` was answering
 * `200 text/html` because the `[...slug]` no-404 engine caught it, which is
 * what makes agent tooling report "returned HTML instead of JSON". The two
 * honest options were "404" or "serve the real spec"; since exactly two public
 * unauthenticated JSON endpoints exist, describing them costs little and is
 * strictly more useful than a 404.
 *
 * SCOPE — deliberately only the endpoints that are genuinely public and safe
 * for an unauthenticated agent to call:
 *   - GET /api/products
 *   - GET /api/collections
 *
 * Everything else under `/api/*` (cart, checkout, customer, saved cards, pay)
 * is a cookie-session + CSRF surface for a browser. It is NOT documented here,
 * because publishing it would advertise a machine-callable contract that
 * double-submit CSRF makes unusable to an agent anyway.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveStoreDomainFromHeaders } from "@/lib/seo";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const host = (req.headers.get("host") || "").trim();
  const proto =
    req.headers.get("x-forwarded-proto") ||
    (host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https");
  const origin = `${proto}://${host}`;
  const domain = resolveStoreDomainFromHeaders(req.headers);

  const storeIdParam = {
    name: "store_id",
    in: "query",
    required: true,
    description:
      "The store's UUID. Published in this store's /.well-known/acp.json " +
      "under capabilities.services.catalog.store_id.",
    schema: { type: "string", format: "uuid" },
  };

  const spec = {
    openapi: "3.1.0",
    info: {
      title: `${domain || host} — public storefront API`,
      version: "1.0.0",
      description:
        "Public, unauthenticated read endpoints for this NUMU storefront. " +
        "Transactional endpoints (cart, checkout, customer) require a browser " +
        "session with CSRF double-submit and are intentionally not described " +
        "here.",
    },
    servers: [{ url: origin }],
    paths: {
      "/api/products": {
        get: {
          operationId: "listProducts",
          summary: "List published products for a store",
          parameters: [
            storeIdParam,
            {
              name: "limit",
              in: "query",
              required: false,
              description: "Maximum number of products to return.",
              schema: { type: "integer", default: 20, minimum: 1 },
            },
          ],
          responses: {
            "200": {
              description: "Product list.",
              content: { "application/json": { schema: { type: "object" } } },
            },
            "400": { description: "store_id query param missing." },
          },
        },
      },
      "/api/collections": {
        get: {
          operationId: "listCollections",
          summary: "List product collections (categories) for a store",
          parameters: [storeIdParam],
          responses: {
            "200": {
              description: "Collection list.",
              content: { "application/json": { schema: { type: "object" } } },
            },
            "400": { description: "store_id query param missing." },
          },
        },
      },
    },
  };

  return NextResponse.json(spec, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
    },
  });
}

/**
 * ACP discovery document — served at `/.well-known/acp.json`.
 *
 * `proxy.ts` rewrites `/.well-known/acp.json` here; Next's file-system router
 * will not register a `.well-known` app segment, and letting the path fall to
 * the `[...slug]` catch-all is exactly the bug this fixes (a `.json` path was
 * answering `200 text/html`, which is what makes agent tooling report
 * "returned HTML instead of JSON").
 *
 * ── What this document does and does NOT claim ─────────────────────────────
 *
 * Publishing discovery metadata advertises a contract. Claiming a transactable
 * agentic checkout NUMU has not built would make every agent that trusts this
 * file fail at the last step — worse for the merchant than publishing nothing.
 *
 * So this document is deliberately scoped to what is REAL and verifiable today:
 *
 *   - `services.catalog` — GET /api/products and GET /api/collections exist,
 *     are public, unauthenticated, and return JSON (see those route handlers).
 *   - `services.checkout` — declared `human_only`, pointing at the store's
 *     hosted checkout URL. NUMU's checkout is a cookie-session flow with CSRF
 *     double-submit and Egyptian payment rails (Paymob / Fawry / InstaPay /
 *     COD); there is no agent-callable order-placement contract, and this file
 *     says so rather than implying one.
 *
 * When an agent-transactable checkout does exist, extend `services.checkout`
 * here — the discovery surface is already in place.
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchStoreByDomain } from "@/lib/api-client";
import { resolveStoreDomainFromHeaders } from "@/lib/seo";

export const dynamic = "force-dynamic";

/** ACP revision this document is shaped against. */
const ACP_VERSION = "2025-09-29";

export async function GET(req: NextRequest) {
  const host = (req.headers.get("host") || "").trim();
  const proto =
    req.headers.get("x-forwarded-proto") ||
    (host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https");
  const origin = `${proto}://${host}`;

  const domain = resolveStoreDomainFromHeaders(req.headers);

  // Best-effort store identity. A failed lookup must NOT 500 the discovery
  // document — an agent reading a broken /.well-known is worse off than one
  // reading a document with a generic name.
  let storeName: string | null = null;
  let storeCurrency: string | null = null;
  let storeId: string | null = null;
  if (domain) {
    try {
      const store = (await fetchStoreByDomain(domain)) as {
        id?: string;
        name?: string;
        currency?: string;
      } | null;
      storeName = store?.name ?? null;
      storeCurrency = store?.currency ?? null;
      storeId = store?.id ?? null;
    } catch {
      /* generic document below */
    }
  }

  const body = {
    protocol: { name: "acp", version: ACP_VERSION },
    api_base_url: `${origin}/api`,
    transports: ["https"],
    merchant: {
      name: storeName || domain || host,
      url: origin,
      ...(storeCurrency ? { currency: storeCurrency } : {}),
    },
    capabilities: {
      services: {
        // Real, public, unauthenticated JSON endpoints. `store_id` is required
        // by both, so it is published here rather than left for an agent to
        // guess — without it these routes 400.
        catalog: {
          available: Boolean(storeId),
          ...(storeId ? { store_id: storeId } : {}),
          endpoints: [
            {
              rel: "products",
              method: "GET",
              href: `${origin}/api/products?store_id={store_id}&limit={limit}`,
              media_type: "application/json",
            },
            {
              rel: "collections",
              method: "GET",
              href: `${origin}/api/collections?store_id={store_id}`,
              media_type: "application/json",
            },
          ],
        },
        // Honesty clause. See the header comment: there is no agent-callable
        // order-placement contract, so none is advertised.
        checkout: {
          available: false,
          mode: "human_only",
          href: `${origin}/checkout`,
          reason:
            "Checkout is a browser session flow (cookie auth + CSRF) with " +
            "Egyptian payment rails. No agent-callable order placement is " +
            "offered at this time.",
        },
      },
    },
    documentation: {
      llms_txt: `${origin}/llms.txt`,
      openapi: `${origin}/openapi.json`,
      sitemap: `${origin}/sitemap.xml`,
    },
  };

  return NextResponse.json(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // Discovery metadata is stable and store-scoped, not visitor-scoped.
      "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
    },
  });
}

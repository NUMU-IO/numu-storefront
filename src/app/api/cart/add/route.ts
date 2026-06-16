/**
 * POST /api/cart/add — proxies through to the FastAPI cart-add endpoint.
 *
 * The SDK calls this without knowing the backend URL; this route owns
 * cookie/session forwarding so theme code stays portable across hosts.
 * CSRF + idempotency are enforced by the shared cart-proxy helper.
 *
 * Also fires a server-side CAPI AddToCart on success (Meta funnel) — the
 * browser-side fbq AddToCart lands later via the SDK's useCart auto-fire,
 * which the host's <MetaPixel> bridge already forwards.
 */

import { NextRequest } from "next/server";
import { after } from "next/server";
import { proxyCartMutation } from "@/lib/cart-proxy";
import { fireServerCapi } from "@/lib/server-capi";

interface AddPayload {
  product_id?: string;
  variant_id?: string;
  quantity?: number;
  _event_id?: string;
}

export async function POST(req: NextRequest) {
  // Read the payload from a clone so the proxy can still consume req.body.
  let payload: AddPayload | null = null;
  try {
    payload = (await req.clone().json()) as AddPayload;
  } catch {
    /* non-JSON body — skip the AddToCart event, still proxy the write */
  }

  const res = await proxyCartMutation(req, "/storefront/cart/add");

  const contentId = payload?.product_id || payload?.variant_id;
  if (res.ok && contentId) {
    // Post-response so add-to-cart latency is unaffected.
    after(() =>
      fireServerCapi(
        req,
        "add_to_cart",
        {
          content_ids: [contentId],
          content_type: "product",
          num_items: Number(payload?.quantity) || 1,
        },
        { eventId: payload?._event_id },
      ),
    );
  }

  return res;
}

/**
 * Public order-tracking route: /{domain}/track/{orderId}
 *
 * Guest-accessible (no auth) — anyone with the order's confirmation link can
 * view the live status. The order tracking URL emitted by checkout
 * (`{base}/track/{order_id}`) points here.
 */
import { TrackOrder } from "./TrackOrder";
import { NOINDEX_ROBOTS } from "@/lib/seo";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

// Guest-accessible by design, which is exactly why it must not be indexed: the
// URL carries an order id and the page shows that buyer's status. robots.txt
// can't be relied on (Cloudflare serves it for these hosts and allows
// everything), so the meta tag is the enforceable layer. Robots only — the
// title stays inherited from the store shell rather than hardcoded English.
export const metadata: Metadata = { robots: NOINDEX_ROBOTS };

export default async function TrackPage({
  params,
}: {
  params: Promise<{ domain: string; orderId: string }>;
}) {
  const { domain, orderId } = await params;
  return <TrackOrder orderId={orderId} domain={domain} />;
}

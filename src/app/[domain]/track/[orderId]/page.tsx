/**
 * Public order-tracking route: /{domain}/track/{orderId}
 *
 * Guest-accessible (no auth) — anyone with the order's confirmation link can
 * view the live status. The order tracking URL emitted by checkout
 * (`{base}/track/{order_id}`) points here.
 */
import { TrackOrder } from "./TrackOrder";

export const dynamic = "force-dynamic";

export default async function TrackPage({
  params,
}: {
  params: Promise<{ domain: string; orderId: string }>;
}) {
  const { domain, orderId } = await params;
  return <TrackOrder orderId={orderId} domain={domain} />;
}

/**
 * Step 6 — Thank-you confirmation. Phase 7.1 BYOT fork + Phase 2 enrichment.
 *
 * We server-fetch the full order detail (line items, address, totals,
 * coupon, offers) from the request cookie and thread it BOTH ways:
 *   - BYOT path: into the bundle mount ctx as `page.data.order` (alongside
 *     order_id/order_number) so a theme's checkout_thank_you can render the
 *     same data via ctx instead of a client round-trip.
 *   - Built-in path: as `initialOrder` so <ThankYou> paints immediately.
 *
 * The fetch is best-effort (guests whose cookie doesn't carry the order get
 * null) — <ThankYou> re-fetches client-side and degrades gracefully.
 */

import { headers } from "next/headers";
import { resolveByotFork } from "@/lib/byot-fork";
import { fetchCustomerOrder } from "@/lib/api-client";
import { notFound } from "next/navigation";
import { ThankYou } from "./ThankYou";
import { FunnelTracker } from "@/components/tracking/FunnelTracker";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ domain: string; order_id: string }>;
  searchParams: Promise<{ n?: string }>;
}

export default async function ThankYouPage({
  params,
  searchParams,
}: PageProps) {
  const { domain, order_id } = await params;
  const { n } = await searchParams;

  // Best-effort server prefetch of the full order from the customer cookie.
  const cookieHeader = (await headers()).get("cookie");
  const order = await fetchCustomerOrder(cookieHeader, order_id).catch(
    () => null,
  );

  const fork = await resolveByotFork(domain, {
    type: "checkout_thank_you",
    title: "Order confirmed",
    handle: order_id,
    data: { order_id, order_number: n || null, order },
  });
  if (fork.kind === "missing-store") notFound();

  // Meta Purchase — fires in both BYOT + built-in branches. eventID = order id
  // so it dedupes against the payment-webhook CAPI Purchase (same id). Order
  // totals are integer cents → MAJOR units for Meta.
  const purchaseLines: Array<Record<string, unknown>> = Array.isArray(
    order?.line_items,
  )
    ? order!.line_items
    : Array.isArray(order?.items)
      ? order!.items
      : [];
  const orderTotal = order?.total;
  const purchaseTracker = (
    <FunnelTracker
      step="order_completed"
      eventId={order_id}
      dedupeKey={`purchase_${order_id}`}
      data={{
        order_id,
        order_number: order?.order_number || n || undefined,
        value: typeof orderTotal === "number" ? orderTotal / 100 : undefined,
        currency: (order?.currency as string) || "EGP",
        content_ids: purchaseLines
          .map((l) => l.product_id)
          .filter((x): x is string => typeof x === "string"),
        content_type: purchaseLines.length ? "product" : undefined,
        num_items: purchaseLines.reduce(
          (acc, l) => acc + (Number(l.quantity) || 0),
          0,
        ),
      }}
    />
  );

  if (fork.kind === "byot")
    return (
      <>
        {purchaseTracker}
        {fork.element}
      </>
    );
  return (
    <>
      {purchaseTracker}
      <ThankYou
        orderId={order_id}
        orderNumberFromUrl={n || null}
        // fetchCustomerOrder returns the loose Record<string,any> backend
        // shape; ThankYou's Order interface is structurally a subset of it.
        initialOrder={
          (order as React.ComponentProps<typeof ThankYou>["initialOrder"]) ??
          null
        }
      />
    </>
  );
}

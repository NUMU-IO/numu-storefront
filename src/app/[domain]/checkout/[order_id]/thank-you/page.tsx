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
import { fetchCustomerOrder, fetchPublicOrderTracking } from "@/lib/api-client";
import { notFound } from "next/navigation";
import { ThankYou } from "./ThankYou";
import { FunnelTracker } from "@/components/tracking/FunnelTracker";
import { NOINDEX_ROBOTS } from "@/lib/seo";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

// checkout/layout.tsx already noindexes the whole segment; declared here too
// because this is the confirmation URL buyers actually share and paste (it
// carries a real order id), so it should not depend on an ancestor layout it
// could one day be moved out of.
export const metadata: Metadata = { robots: NOINDEX_ROBOTS };

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

  // Guest fallback for the Purchase event ONLY. The fetch above needs a
  // customer session, so a guest checkout gets null — and the Purchase then
  // fired with no `value`, which Meta rejects outright. On a COD store where
  // most buyers never make an account that was every order. This public view
  // is PII-sanitised (see fetchPublicOrderTracking) and is used solely for
  // totals/quantities; it is NOT threaded into the theme ctx or <ThankYou>,
  // both of which already re-fetch client-side with the buyer's own session.
  const purchaseFallback = order
    ? null
    : await fetchPublicOrderTracking(order_id, domain).catch(() => null);

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
  // Totals AND `content_ids` both fall back to the public order view for
  // guests. That view used to carry no product_id, so a guest Purchase — most
  // COD buyers — reached Meta with no product attribution at all: the catalog
  // could not be credited, and those shoppers were never cleared out of
  // "viewed but didn't buy" retargeting audiences. The projection now exposes
  // the merchant's Meta catalog id where one exists, so these ids join the
  // product feed rather than being internal UUIDs.
  const fallbackLines: Array<Record<string, unknown>> = Array.isArray(
    purchaseFallback?.line_items,
  )
    ? (purchaseFallback!.line_items as Array<Record<string, unknown>>)
    : [];
  const orderTotal = order?.total ?? purchaseFallback?.total;
  const orderCurrency =
    (order?.currency as string) || (purchaseFallback?.currency as string);
  const quantityLines = purchaseLines.length ? purchaseLines : fallbackLines;
  const contentIds = quantityLines
    .map((l) => l.product_id)
    .filter((x): x is string => typeof x === "string" && x.length > 0);

  const purchaseTracker = (
    <FunnelTracker
      step="order_completed"
      eventId={order_id}
      dedupeKey={`purchase_${order_id}`}
      data={{
        order_id,
        order_number:
          order?.order_number || purchaseFallback?.order_number || n || undefined,
        value: typeof orderTotal === "number" ? orderTotal / 100 : undefined,
        currency: orderCurrency || "EGP",
        // Omit rather than send [] — an empty array is a claim that the
        // purchase contained no products.
        content_ids: contentIds.length ? contentIds : undefined,
        content_type: contentIds.length ? "product" : undefined,
        // Per-line detail: TikTok's catalog pipeline reads
        // `contents[].content_id`, and Meta's dynamic ads use the same shape.
        contents: contentIds.length
          ? quantityLines
              .filter((l) => typeof l.product_id === "string" && l.product_id)
              .map((l) => ({
                id: l.product_id,
                quantity: Number(l.quantity) || 1,
                ...(typeof l.unit_price === "number"
                  ? { item_price: l.unit_price / 100 }
                  : {}),
              }))
          : undefined,
        num_items:
          quantityLines.reduce((acc, l) => acc + (Number(l.quantity) || 0), 0) ||
          undefined,
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

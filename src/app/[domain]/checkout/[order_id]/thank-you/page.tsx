/**
 * Step 6 — thank-you / confirmation.
 *
 * Renders after a successful order. We fetch the order from
 * /api/customer/orders/{order_id} to display the line items + total.
 * Non-authenticated visitors (guest checkout) can still see this page
 * via the cart cookie scope — the backend uses the same session
 * cookie to authorize a "your order" read for the immediate post-
 * checkout window.
 *
 * No checkout state cleanup needed here — the review step already
 * called clearCheckoutState() before navigating.
 */

import { ThankYou } from "./ThankYou";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ domain: string; order_id: string }>;
  searchParams: Promise<{ n?: string }>;
}

export default async function ThankYouPage({
  params,
  searchParams,
}: PageProps) {
  const { order_id } = await params;
  const { n } = await searchParams;
  return <ThankYou orderId={order_id} orderNumberFromUrl={n || null} />;
}

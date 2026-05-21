/**
 * Step 6 — Thank-you confirmation. Phase 7.1 BYOT fork.
 *
 * BYOT path passes the order_id through `page.handle` so themes can
 * fetch + render the order details via `useOrder(handle)`.
 */

import { resolveByotFork } from "@/lib/byot-fork";
import { notFound } from "next/navigation";
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
  const { domain, order_id } = await params;
  const { n } = await searchParams;
  const fork = await resolveByotFork(domain, {
    type: "checkout_thank_you",
    title: "Order confirmed",
    handle: order_id,
    data: { order_id, order_number: n || null },
  });
  if (fork.kind === "missing-store") notFound();
  if (fork.kind === "byot") return fork.element;
  return <ThankYou orderId={order_id} orderNumberFromUrl={n || null} />;
}

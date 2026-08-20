/**
 * /[domain]/instapay/[orderId] — finish an InstaPay payment.
 *
 * Landing page for the "upload payment proof" link in the order
 * confirmation and proof-rejection emails. See the sibling
 * /vodafone-cash/[orderId] route: both mount the same component, which
 * reads the rail off the API's status response rather than the URL.
 *
 * force-dynamic — whether the order is still awaiting payment must be
 * read fresh on every visit, never ISR-cached.
 */

import { ManualPaymentResume } from "@/components/checkout/ManualPaymentResume";
import { NOINDEX_ROBOTS } from "@/lib/seo";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

// One buyer's payment, reachable by anyone holding the link — never index
// it. `referrer: no-referrer` matters as much as the robots tag here: the
// URL carries the intent reference code as ?ref=, which authorizes the
// proof endpoints, and a Referer header would hand it to any host the
// page links out to.
export const metadata: Metadata = {
  robots: NOINDEX_ROBOTS,
  referrer: "no-referrer",
};

interface PageProps {
  params: Promise<{ domain: string; orderId: string }>;
  searchParams: Promise<{ ref?: string }>;
}

export default async function InstapayResumePage({
  params,
  searchParams,
}: PageProps) {
  const { orderId } = await params;
  const { ref } = await searchParams;
  return (
    <div className="mx-auto max-w-lg px-4 py-8">
      <ManualPaymentResume orderId={orderId} initialReference={ref || null} />
    </div>
  );
}

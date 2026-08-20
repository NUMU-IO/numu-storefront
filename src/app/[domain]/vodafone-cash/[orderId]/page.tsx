/**
 * /[domain]/vodafone-cash/[orderId] — finish a Vodafone Cash payment.
 *
 * Sibling of /instapay/[orderId]; both render the same component, which
 * reads the rail off the API's status response rather than the URL. Two
 * explicit segments rather than one `[method]` catch-all: a two-level
 * dynamic route at this depth would swallow every unmatched two-segment
 * path on the storefront.
 *
 * force-dynamic — whether the order is still awaiting payment must be
 * read fresh on every visit, never ISR-cached.
 */

import { ManualPaymentResume } from "@/components/checkout/ManualPaymentResume";
import { NOINDEX_ROBOTS } from "@/lib/seo";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

// See the InstaPay sibling: noindex because it is one buyer's payment,
// and no-referrer because the URL carries the authorizing ?ref= code.
export const metadata: Metadata = {
  robots: NOINDEX_ROBOTS,
  referrer: "no-referrer",
};

interface PageProps {
  params: Promise<{ domain: string; orderId: string }>;
  searchParams: Promise<{ ref?: string }>;
}

export default async function VodafoneCashResumePage({
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

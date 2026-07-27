/**
 * Guest order-lookup route: /{domain}/track
 *
 * The front door for the sibling `track/{orderId}` view: a shopper who has an
 * order number but not the (unguessable) tracking link exchanges it — plus the
 * phone or email they checked out with — for the order id, then lands on the
 * detail page.
 *
 * Why this static segment exists: `/track` used to fall through to
 * `[...slug]`, where "track" was a KNOWN_PAGE_HANDLES entry. That answered
 * HTTP 200 with a synthesised, body-less `page`, so every V3 theme footer's
 * "Track order" link rendered header + a lone "Track" heading + footer. Next
 * gives a static segment priority over the catch-all (and it coexists with the
 * sibling `[orderId]` dynamic segment), so this route now claims the path.
 *
 * Standalone — no theme boundary, exactly like `track/[orderId]` — so the
 * lookup form and the order view it leads to read as one flow.
 */
import { NOINDEX_ROBOTS } from "@/lib/seo";
import { TrackLookup } from "./TrackLookup";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ domain: string }>;
  searchParams: Promise<{ tn?: string }>;
}

// Entity title only — the `[domain]` layout's title template appends the store
// name, so this no longer needs to resolve the store.
export const metadata: Metadata = {
  title: "Track your order",
  // A lookup form has nothing to index, and a crawler that submitted it would
  // be indexing someone's order. Never crawlable.
  robots: NOINDEX_ROBOTS,
};

export default async function TrackLookupPage({ params, searchParams }: PageProps) {
  const { domain } = await params;
  // The post-purchase "Track Order" CTA already links to
  // `/track?tn=<order_number>` — nothing read `tn`, so the shopper arrived at
  // an empty page and had to retype a number they'd just been handed. Read it
  // here (the route is force-dynamic anyway) and seed the form.
  const { tn } = await searchParams;

  return (
    <TrackLookup
      domain={domain}
      initialOrderNumber={typeof tn === "string" ? tn : ""}
    />
  );
}

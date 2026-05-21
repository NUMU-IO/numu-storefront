/**
 * Step 2 — Shipping rate selection. Phase 7.1 BYOT fork.
 */

import { resolveByotFork } from "@/lib/byot-fork";
import { notFound } from "next/navigation";
import { ShippingStep } from "./ShippingStep";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ domain: string }>;
}

export default async function ShippingStepPage({ params }: PageProps) {
  const { domain } = await params;
  const fork = await resolveByotFork(domain, {
    type: "checkout_shipping",
    title: "Checkout — Shipping",
  });
  if (fork.kind === "missing-store") notFound();
  if (fork.kind === "byot") return fork.element;
  return <ShippingStep />;
}

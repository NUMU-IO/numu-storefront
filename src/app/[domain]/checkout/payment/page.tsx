/**
 * Step 3 — Payment method picker. Phase 7.1 BYOT fork.
 */

import { resolveByotFork } from "@/lib/byot-fork";
import { notFound } from "next/navigation";
import { PaymentStep } from "./PaymentStep";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ domain: string }>;
}

export default async function PaymentStepPage({ params }: PageProps) {
  const { domain } = await params;
  const fork = await resolveByotFork(domain, {
    type: "checkout_payment",
    title: "Checkout — Payment",
  });
  if (fork.kind === "missing-store") notFound();
  if (fork.kind === "byot") return fork.element;
  return <PaymentStep />;
}

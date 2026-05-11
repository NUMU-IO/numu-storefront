/**
 * Step 4 — Review + place order. Phase 7.1 BYOT fork.
 */

import { resolveByotFork } from "@/lib/byot-fork";
import { notFound } from "next/navigation";
import { ReviewStep } from "./ReviewStep";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ domain: string }>;
}

export default async function ReviewStepPage({ params }: PageProps) {
  const { domain } = await params;
  const fork = await resolveByotFork(domain, {
    type: "checkout_review",
    title: "Checkout — Review",
  });
  if (fork.kind === "missing-store") notFound();
  if (fork.kind === "byot") return fork.element;
  return <ReviewStep />;
}

/**
 * Step 5 — Payment processing safety net. Phase 7.1 BYOT fork.
 */

import { resolveByotFork } from "@/lib/byot-fork";
import { notFound } from "next/navigation";
import { ProcessingStep } from "./ProcessingStep";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ domain: string }>;
}

export default async function ProcessingStepPage({ params }: PageProps) {
  const { domain } = await params;
  const fork = await resolveByotFork(domain, {
    type: "checkout_processing",
    title: "Checkout — Processing",
  });
  if (fork.kind === "missing-store") notFound();
  if (fork.kind === "byot") return fork.element;
  return <ProcessingStep />;
}

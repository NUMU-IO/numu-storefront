/**
 * Step 1 — Contact + shipping address.
 *
 * Entry point of the checkout flow. Forks BYOT vs built-in (Phase 7.1):
 *   - BYOT: theme bundle renders the contact form using
 *     `page.type="checkout_contact"`. Themes drive the form via
 *     `useCheckout()` (Phase 7.6 SDK hook).
 *   - Built-in: render the in-house `<ContactStep>` client component
 *     that ships with the platform.
 *
 * Authenticated customers get the email pre-filled and (if they have
 * a default address) the shipping fields pre-filled.
 */

import { resolveByotFork } from "@/lib/byot-fork";
import { notFound } from "next/navigation";
import { ContactStep } from "./ContactStep";

export const dynamic = "force-dynamic"; // Don't ISR the checkout

interface PageProps {
  params: Promise<{ domain: string }>;
}

export default async function ContactStepPage({ params }: PageProps) {
  const { domain } = await params;
  const fork = await resolveByotFork(domain, {
    type: "checkout_contact",
    title: "Checkout — Contact",
  });
  if (fork.kind === "missing-store") notFound();
  if (fork.kind === "byot") return fork.element;
  return <ContactStep />;
}

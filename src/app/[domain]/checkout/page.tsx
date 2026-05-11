/**
 * Step 1 — Contact + shipping address.
 *
 * Entry point of the checkout flow. Customer fills email + phone +
 * shipping address; we save to sessionStorage and move them to the
 * shipping rate selection step.
 *
 * Authenticated customers get the email pre-filled and (if they have
 * a default address) the shipping fields pre-filled — fetched client-
 * side via /api/customer/me. Guests start with everything empty.
 */

import { ContactStep } from "./ContactStep";

export const dynamic = "force-dynamic"; // Don't ISR the checkout

export default function ContactStepPage() {
  return <ContactStep />;
}

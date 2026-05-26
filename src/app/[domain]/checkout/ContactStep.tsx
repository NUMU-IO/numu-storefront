"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { StepIndicator } from "@/components/checkout/StepIndicator";
import {
  patchCheckoutState,
  readCheckoutState,
} from "@/lib/checkout-state";

const COUNTRIES = [
  ["EG", "Egypt"],
  ["AE", "United Arab Emirates"],
  ["SA", "Saudi Arabia"],
  ["KW", "Kuwait"],
  ["QA", "Qatar"],
  ["BH", "Bahrain"],
  ["OM", "Oman"],
  ["JO", "Jordan"],
  ["LB", "Lebanon"],
] as const;

export function ContactStep() {
  const router = useRouter();
  const params = useParams() as { domain: string };
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("EG");
  // backend-030 / FR-007: WhatsApp marketing consent. Default OFF —
  // GDPR Recital 47 requires an unticked, freely-given opt-in. The
  // checkbox is rendered next to the phone field and the opt-in is
  // fired (best-effort) on Continue.
  const [whatsappConsent, setWhatsappConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Hydrate from sessionStorage on mount so a back-nav doesn't
    // blank the form.
    const s = readCheckoutState();
    setEmail(s.email);
    setPhone(s.phone);
    setFirstName(s.shipping_address?.first_name || "");
    setLastName(s.shipping_address?.last_name || "");
    setLine1(s.shipping_address?.line1 || "");
    setLine2(s.shipping_address?.line2 || "");
    setCity(s.shipping_address?.city || "");
    setState(s.shipping_address?.state || "");
    setPostalCode(s.shipping_address?.postal_code || "");
    setCountry(s.shipping_address?.country || "EG");

    // Authenticated customer pre-fill — best-effort.
    (async () => {
      try {
        const res = await fetch("/api/customer/me", { cache: "no-store" });
        if (res.ok) {
          const body = await res.json();
          const c = body?.data || body;
          if (c?.email && !s.email) setEmail(c.email);
          if (c?.phone && !s.phone) setPhone(c.phone);
        }
      } catch {
        /* anonymous visitor — fine */
      }
    })();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email || !line1 || !city || !country) {
      setError("Email, address line 1, city, and country are required.");
      return;
    }
    setSubmitting(true);

    // backend-030 / FR-007: fire-and-forget WhatsApp opt-in. The proxy
    // route does the 2-step checkout-session → opt-in dance server-side.
    // Failures are swallowed — a consent recording problem must never
    // block the customer from moving to shipping.
    if (whatsappConsent && phone) {
      void fetch("/api/whatsapp/opt-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      }).catch(() => {
        /* best-effort */
      });
    }

    patchCheckoutState({
      email,
      phone,
      shipping_address: {
        first_name: firstName,
        last_name: lastName,
        line1,
        line2: line2 || null,
        city,
        state: state || null,
        postal_code: postalCode || null,
        country,
        phone: phone || null,
      },
      // Clear downstream selections that depend on the address — a
      // changed address might invalidate the previously-picked rate.
      selected_shipping_rate_id: null,
      shipping_method: null,
    });
    // Stay on [domain]/checkout/shipping; useParams keeps the prefix.
    router.push(`/${params.domain}/checkout/shipping`);
  }

  return (
    <>
      <StepIndicator current="contact" />
      <form onSubmit={submit} className="space-y-6" noValidate>
        <section
          className="bg-white p-6 rounded border"
          aria-labelledby="contact-heading"
        >
          <h2 id="contact-heading" className="text-lg font-semibold mb-4">
            Contact
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm text-gray-700">Email</span>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 block w-full border rounded px-3 py-2"
              />
            </label>
            <label className="block">
              <span className="text-sm text-gray-700">Phone</span>
              <input
                type="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="mt-1 block w-full border rounded px-3 py-2"
              />
            </label>
          </div>
          {/* WhatsApp marketing consent. Default unticked per GDPR
              Recital 47. Disabled until a phone is typed — there's
              nothing to record an opt-in against without one. */}
          <label
            htmlFor="wa_consent"
            className="mt-3 flex items-start gap-2 text-sm text-gray-700 cursor-pointer select-none"
          >
            <input
              id="wa_consent"
              type="checkbox"
              checked={whatsappConsent}
              disabled={!phone}
              onChange={(e) => setWhatsappConsent(e.target.checked)}
              className="mt-0.5 h-4 w-4"
            />
            <span className="text-xs text-gray-600 leading-tight">
              Send me WhatsApp updates from this store (offers, restocks).
              You can reply STOP at any time to opt out.
            </span>
          </label>
        </section>

        <section
          className="bg-white p-6 rounded border"
          aria-labelledby="ship-heading"
        >
          <h2 id="ship-heading" className="text-lg font-semibold mb-4">
            Shipping address
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-sm text-gray-700">First name</span>
              <input
                autoComplete="given-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                className="mt-1 block w-full border rounded px-3 py-2"
              />
            </label>
            <label className="block">
              <span className="text-sm text-gray-700">Last name</span>
              <input
                autoComplete="family-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                className="mt-1 block w-full border rounded px-3 py-2"
              />
            </label>
            <label className="block md:col-span-2">
              <span className="text-sm text-gray-700">Address</span>
              <input
                required
                autoComplete="address-line1"
                value={line1}
                onChange={(e) => setLine1(e.target.value)}
                className="mt-1 block w-full border rounded px-3 py-2"
              />
            </label>
            <label className="block md:col-span-2">
              <span className="text-sm text-gray-700">
                Apartment, suite, etc. (optional)
              </span>
              <input
                autoComplete="address-line2"
                value={line2}
                onChange={(e) => setLine2(e.target.value)}
                className="mt-1 block w-full border rounded px-3 py-2"
              />
            </label>
            <label className="block">
              <span className="text-sm text-gray-700">City</span>
              <input
                required
                autoComplete="address-level2"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="mt-1 block w-full border rounded px-3 py-2"
              />
            </label>
            <label className="block">
              <span className="text-sm text-gray-700">State / Governorate</span>
              <input
                autoComplete="address-level1"
                value={state}
                onChange={(e) => setState(e.target.value)}
                className="mt-1 block w-full border rounded px-3 py-2"
              />
            </label>
            <label className="block">
              <span className="text-sm text-gray-700">Postal code</span>
              <input
                autoComplete="postal-code"
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
                className="mt-1 block w-full border rounded px-3 py-2"
              />
            </label>
            <label className="block">
              <span className="text-sm text-gray-700">Country</span>
              <select
                required
                autoComplete="country"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                className="mt-1 block w-full border rounded px-3 py-2 bg-white"
              >
                {COUNTRIES.map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        {error && (
          <div
            role="alert"
            className="bg-red-50 border border-red-200 text-red-700 text-sm rounded p-3"
          >
            {error}
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={submitting}
            className="bg-gray-900 text-white px-6 py-2 rounded hover:bg-gray-800 disabled:opacity-50"
          >
            {submitting ? "…" : "Continue to shipping"}
          </button>
        </div>
      </form>
    </>
  );
}

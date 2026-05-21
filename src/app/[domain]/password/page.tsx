/**
 * /password — pre-launch unlock gate.
 *
 * Phase 7.3 BYOT fork: themes that ship a `password` template
 * render the gate themselves (logo + tagline + custom form) using
 * `page.type="password"` and `page.data.next`. The form still POSTs
 * to /api/storefront/unlock and the BYOT theme uses
 * `<Form action="/api/storefront/unlock" method="POST">` from the SDK.
 *
 * Built-in fallback ships when the theme doesn't have a password
 * template OR when the active theme isn't BYOT.
 */
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { fetchStoreByDomain } from "@/lib/api-client";
import { readPasswordProtection } from "@/lib/store-lock";
import { resolveByotFork } from "@/lib/byot-fork";
import { PasswordForm } from "@/components/account/PasswordGateForm";
import type { Metadata } from "next";

interface PageProps {
  params: Promise<{ domain: string }>;
  searchParams: Promise<{ next?: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { domain } = await params;
  try {
    const store = await fetchStoreByDomain(domain);
    return { title: `${store?.name || "Store"} — Coming soon` };
  } catch {
    return { title: "Coming soon" };
  }
}

export default async function PasswordPage({
  params,
  searchParams,
}: PageProps) {
  const { domain } = await params;
  const sp = await searchParams;

  let store: any = null;
  try {
    store = await fetchStoreByDomain(domain);
  } catch {
    // Store doesn't resolve — fall through to a generic "coming soon" UI.
  }

  const protection = readPasswordProtection(store);
  if (!protection) {
    // No gate is configured. Don't trap the visitor on this route.
    redirect("/");
  }

  // Guard against open-redirect: only allow `next` values that are
  // same-origin paths starting with "/". Anything else (a full URL,
  // protocol-relative, javascript:) silently falls back to "/".
  const rawNext = sp?.next ?? "";
  const next =
    typeof rawNext === "string" &&
    rawNext.startsWith("/") &&
    !rawNext.startsWith("//")
      ? rawNext
      : "/";

  // Phase 7.3 — let BYOT themes own the password gate UI completely.
  // Theme's `password` template reads `page.data.next` and renders
  // whatever form layout it wants; submit still goes to
  // /api/storefront/unlock so the platform owns auth.
  const fork = await resolveByotFork(domain, {
    type: "password",
    title: "Coming soon",
    data: { next },
  });
  if (fork.kind === "byot") return fork.element;

  // Surface the merchant's brand even on the locked page — visitors
  // who landed here from a marketing campaign should see the store
  // name, not a generic platform shell.
  const headerList = await headers();
  void headerList; // touched for nextjs ssr edge

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-12 bg-gray-50">
      <div className="w-full max-w-md space-y-6 bg-white rounded-xl shadow-sm border border-gray-200 p-8">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold">
            {store?.name || "Coming soon"}
          </h1>
          <p className="text-sm text-gray-600">
            We're putting the finishing touches on the store. Enter the
            preview password to take a look.
          </p>
        </div>
        <PasswordForm next={next} />
      </div>
    </main>
  );
}

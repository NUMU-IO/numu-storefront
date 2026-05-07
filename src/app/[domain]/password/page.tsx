/**
 * /password — pre-launch unlock gate.
 *
 * Renders a single password input. The form posts JSON to
 * /api/storefront/unlock; on 204 we hard-reload the previous URL
 * (or "/" if there's no return path), at which point the layout's
 * gate sees the unlock cookie and lets the visitor through.
 *
 * If a visitor lands here when the store ISN'T locked, we redirect
 * them to "/" — no point showing a form for a non-existent gate.
 */
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { fetchStoreByDomain } from "@/lib/api-client";
import { readPasswordProtection } from "@/lib/store-lock";
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

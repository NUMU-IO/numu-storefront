import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  fetchStoreByDomain,
  fetchThemeSettings,
  fetchCurrentCustomer,
} from "@/lib/api-client";
import { resolveThemeSettings } from "@/lib/resolve-theme";
import { isBuiltInTheme } from "@/components/theme-engine/ThemeRegistry";
import ByotThemeBoundary from "@/components/theme-engine/ByotThemeBoundary";
import { RegisterForm } from "@/components/account/AuthForms";
import type { Metadata } from "next";

interface PageProps {
  params: Promise<{ domain: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { domain } = await params;
  try {
    const store = await fetchStoreByDomain(domain);
    return { title: `Create account | ${store?.name || "Store"}` };
  } catch {
    return { title: "Create account" };
  }
}

export default async function RegisterPage({ params }: PageProps) {
  const { domain } = await params;
  const headerList = await headers();
  const cookieHeader = headerList.get("cookie");

  const customer = await fetchCurrentCustomer(cookieHeader);
  if (customer) redirect("/account");

  const store = await fetchStoreByDomain(domain);
  const themeRaw = await fetchThemeSettings(store.id);
  const themeSettings = resolveThemeSettings(themeRaw?.theme_settings || themeRaw || {});

  const isByot =
    themeSettings.external_theme?.bundle_url &&
    !isBuiltInTheme(themeSettings.theme_id);

  // Built-in fallback + ENG-2 no-blank backstop for themes with no `register`
  // template.
  const builtInRegister = (
    <main className="min-h-screen flex items-center justify-center px-4 py-12 bg-white">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Create account</h1>
          <p className="text-sm text-gray-600 mt-1">
            Join {store?.name || "the store"} for faster checkout and order
            tracking.
          </p>
        </div>
        <RegisterForm />
      </div>
    </main>
  );

  if (isByot) {
    return (
      <ByotThemeBoundary
        bundleUrl={themeSettings.external_theme!.bundle_url!}
        cssUrl={themeSettings.external_theme!.css_url}
        themeSettings={themeSettings}
        storeData={store}
        page={{ type: "register", title: "Create account" }}
        routeFallback={builtInRegister}
      />
    );
  }

  return builtInRegister;
}

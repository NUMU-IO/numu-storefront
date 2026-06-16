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
import { LoginForm } from "@/components/account/AuthForms";
import type { Metadata } from "next";

interface PageProps {
  params: Promise<{ domain: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { domain } = await params;
  try {
    const store = await fetchStoreByDomain(domain);
    return { title: `Sign in | ${store?.name || "Store"}` };
  } catch {
    return { title: "Sign in" };
  }
}

export default async function LoginPage({ params }: PageProps) {
  const { domain } = await params;
  const headerList = await headers();
  const cookieHeader = headerList.get("cookie");

  // Already logged in? Skip the form and head to the dashboard.
  // We do this server-side so the redirect is cheap and the user
  // never sees a flash of the login form when they're already in.
  const customer = await fetchCurrentCustomer(cookieHeader);
  if (customer) redirect("/account");

  const store = await fetchStoreByDomain(domain);
  const themeRaw = await fetchThemeSettings(store.id);
  const themeSettings = resolveThemeSettings(themeRaw?.theme_settings || themeRaw || {});

  const isByot =
    themeSettings.external_theme?.bundle_url &&
    !isBuiltInTheme(themeSettings.theme_id);

  // Built-in fallback — works on any theme even before BYOT login templates
  // ship. Doubles as the ENG-2 no-blank backstop: account sub-pages redirect
  // anonymous shoppers here, so a blank login (theme with no `login` template)
  // would lock them out entirely.
  const builtInLogin = (
    <main className="min-h-screen flex items-center justify-center px-4 py-12 bg-white">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Sign in</h1>
          <p className="text-sm text-gray-600 mt-1">
            Welcome back to {store?.name || "your store"}.
          </p>
        </div>
        <LoginForm />
      </div>
    </main>
  );

  // BYOT theme renders its own login UI by reading `page.type === "login"`.
  // Themes that haven't shipped a login template fall back to the built-in
  // form. The bundle's forms hit the same `/api/customer/login` proxy so
  // behavior matches.
  if (isByot) {
    return (
      <ByotThemeBoundary
        bundleUrl={themeSettings.external_theme!.bundle_url!}
        cssUrl={themeSettings.external_theme!.css_url}
        themeSettings={themeSettings}
        storeData={store}
        page={{ type: "login", title: "Sign in" }}
        routeFallback={builtInLogin}
      />
    );
  }

  return builtInLogin;
}

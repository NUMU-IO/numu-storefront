import {
  fetchStoreByDomain,
  fetchThemeSettings,
} from "@/lib/api-client";
import { resolveThemeSettings } from "@/lib/resolve-theme";
import { isBuiltInTheme } from "@/components/theme-engine/ThemeRegistry";
import ByotThemeBoundary from "@/components/theme-engine/ByotThemeBoundary";
import { ResetForm } from "@/components/account/AuthForms";
import type { Metadata } from "next";

interface PageProps {
  params: Promise<{ domain: string }>;
  searchParams: Promise<{ token?: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { domain } = await params;
  try {
    const store = await fetchStoreByDomain(domain);
    return { title: `Set new password | ${store?.name || "Store"}` };
  } catch {
    return { title: "Set new password" };
  }
}

export default async function ResetPage({ params, searchParams }: PageProps) {
  const { domain } = await params;
  const sp = await searchParams;
  const token = sp.token || "";

  const store = await fetchStoreByDomain(domain);
  const themeRaw = await fetchThemeSettings(store.id);
  const themeSettings = resolveThemeSettings(themeRaw?.theme_settings || themeRaw || {});

  const isByot =
    themeSettings.external_theme?.bundle_url &&
    !isBuiltInTheme(themeSettings.theme_id);

  if (isByot) {
    return (
      <ByotThemeBoundary
        bundleUrl={themeSettings.external_theme!.bundle_url!}
        cssUrl={themeSettings.external_theme!.css_url}
        themeSettings={themeSettings}
        storeData={store}
        page={{ type: "reset", title: "Set new password", data: { token } }}
      />
    );
  }

  // No token in the URL → render an error explaining how the user should
  // arrive here. Don't render the form — submitting with an empty token
  // would just 400 on the backend.
  if (!token) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4 py-12 bg-white">
        <div className="w-full max-w-md space-y-4 text-center">
          <h1 className="text-2xl font-bold">Reset link missing</h1>
          <p className="text-sm text-gray-600">
            Open the password-reset email we sent and click the link inside.
            That link contains the token needed to reset your password.
          </p>
          <a
            href="/account/recover"
            className="inline-block text-sm font-medium underline"
          >
            Send a new reset link
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-12 bg-white">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Set a new password</h1>
        </div>
        <ResetForm token={token} />
      </div>
    </main>
  );
}

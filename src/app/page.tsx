import { notFound } from "next/navigation";

// Apex / `localhost` landing.
//
// In production the platform domain (numueg.app) is served by a separate
// landing app; this Next instance is only the multi-tenant storefront, so
// hitting the apex here should 404. In dev we render a tiny helper page so
// `localhost:3000` doesn't 404 silently while the developer is just trying
// to find the right URL to test a store.
export default function RootPage() {
  if (process.env.NEXT_PUBLIC_NUMU_ENV === "production") {
    notFound();
  }

  const platformDomain = process.env.NUMU_PLATFORM_DOMAIN || "numueg.local";

  return (
    <main className="mx-auto max-w-2xl px-6 py-16 font-sans leading-relaxed">
      <h1 className="mb-2 text-3xl font-semibold">NUMU Storefront — dev</h1>
      <p className="mt-0 text-neutral-600">
        This Next app is the multi-tenant storefront. The apex domain has no
        store attached, so this page is dev-only.
      </p>

      <h2 className="mt-8 text-base font-semibold">Test a store</h2>
      <p className="mt-0">
        Visit{" "}
        <code className="rounded bg-neutral-100 px-1.5 py-0.5">
          http://&lt;subdomain&gt;.localhost:3000
        </code>{" "}
        — modern browsers resolve <code>*.localhost</code> to{" "}
        <code>127.0.0.1</code> automatically (no hosts-file changes). Example:{" "}
        <a className="text-blue-600 underline" href="http://numu.localhost:3000">
          http://numu.localhost:3000
        </a>
        .
      </p>
      <p className="text-sm text-neutral-500">
        The platform domain in this environment is{" "}
        <code>{platformDomain}</code>; <code>*.localhost</code> works in dev as
        a convenience.
      </p>

      <p className="mt-8 text-xs text-neutral-400">
        This page does not appear in production builds.
      </p>
    </main>
  );
}

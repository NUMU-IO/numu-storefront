import path from "node:path";
import type { NextConfig } from "next";

const isProd = process.env.NEXT_PUBLIC_NUMU_ENV === "production";

const nextConfig: NextConfig = {
  // Pin the workspace root so Turbopack doesn't walk up to the parent
  // directory looking for package.json/lockfiles.
  turbopack: {
    root: path.resolve(__dirname),
  },

  // Allow the merchant hub's V3 customizer iframe (default :8080) to load
  // Next dev assets and HMR. Without this, Next 16 blocks /_next/static/*
  // requests from the iframe with "Blocked cross-origin request" warnings.
  // Production builds don't need this — it's a dev-only escape hatch.
  ...(isProd
    ? {}
    : {
        allowedDevOrigins: [
          "localhost:8080",
          "127.0.0.1:8080",
          "localhost:5173",
          "127.0.0.1:5173",
        ],
      }),

  // Cap how aggressively the dev image cache fills the disk. Default
  // minimumCacheTTL is 60s; raise to 1 hour so we re-fetch less often,
  // but the cap matters more — see deviceSizes/imageSizes below.
  images: {
    minimumCacheTTL: 60 * 60,
    // Restrict the device + image breakpoints so /_next/image doesn't
    // generate 8+ variants per source. Each variant lives in .next/cache.
    deviceSizes: [640, 768, 1024, 1280, 1920],
    imageSizes: [64, 128, 256, 384],
    remotePatterns: [
      { protocol: "https", hostname: "**.numu.io" },
      { protocol: "https", hostname: "**.numueg.app" },
      { protocol: "https", hostname: "**.r2.cloudflarestorage.com" },
      // In dev, allow any HTTPS host so a merchant can drop in any URL
      // for hero images; in prod we narrow to known CDNs.
      ...(isProd ? [] : [{ protocol: "https" as const, hostname: "**" }]),
    ],
  },

  // Skip generating source maps in dev — they're a large chunk of the
  // .next/cache footprint on Windows. Re-enable selectively if you're
  // debugging a hard-to-read stack trace.
  productionBrowserSourceMaps: false,

  experimental: {
    // Enable PPR (partial prerendering) once stable on Next 16.
    // ppr: true,
  },

  // Allow the merchant hub's theme editor to iframe the storefront for live
  // preview. Cloudflare's "Add security headers" managed transform stamps
  // `X-Frame-Options: SAMEORIGIN` on every numueg.app response, which would
  // otherwise block the cross-subdomain embed. Setting a CSP `frame-ancestors`
  // directive overrides X-Frame-Options per CSP Level 2 spec (browsers ignore
  // XFO when frame-ancestors is present in an enforced policy).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "frame-ancestors 'self' https://numueg.app https://*.numueg.app http://localhost:* http://127.0.0.1:*",
          },
        ],
      },
    ];
  },
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.numu.io" },
      { protocol: "https", hostname: "**.r2.cloudflarestorage.com" },
    ],
  },
  experimental: {
    // Enable PPR for partial prerendering
    // ppr: true,
  },
};

export default nextConfig;

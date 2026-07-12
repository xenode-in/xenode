import type { NextConfig } from "next";
import createMDX from "@next/mdx";

const nextConfig: NextConfig = {
  pageExtensions: ["js", "jsx", "md", "mdx", "ts", "tsx"],
  output: "standalone",
  reactStrictMode: false,

  // ── Turbopack: redirect mediainfo.js → CDN shim so the WASM is never bundled ──
  turbopack: {
    resolveAlias: {
      "mediainfo.js": "./lib/metadata/mediainfo-loader",
    },
  },

  // ── Webpack (non-Turbopack builds) ──────────────────────────────────────────
  webpack(config, { isServer }) {
    if (!isServer) {
      // Redirect mediainfo.js → CDN shim at the webpack level too
      config.resolve = config.resolve || {};
      config.resolve.alias = {
        ...(config.resolve.alias || {}),
        "mediainfo.js": require.resolve("./lib/metadata/mediainfo-loader"),
      };
    }
    return config;
  },

  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "xenode.in",
        port: "",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "xenopublic.idr01.zata.ai",
        port: "",
        pathname: "/**",
      },
    ],
  },

  async headers() {
    const relaxedHeaders = [
      { key: "Cross-Origin-Opener-Policy", value: "unsafe-none" },
      { key: "Cross-Origin-Embedder-Policy", value: "unsafe-none" },
    ];

    const strictHeaders = [
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
    ];

    return [
      {
        source: "/",
        headers: relaxedHeaders,
      },
      {
        source: "/plans",
        headers: relaxedHeaders,
      },
      {
        source: "/pricing",
        headers: relaxedHeaders,
      },
      {
        source: "/checkout",
        headers: relaxedHeaders,
      },
      {
        // ── Strict Headers for Dashboard/Media ─────────────────────────────
        // Applied only to routes where SharedArrayBuffer is needed.
        source: "/dashboard/:path*",
        headers: strictHeaders,
      },
      {
        // Fallback catch-all (excluding the public ones above)
        source: "/((?!plans|pricing|checkout).*)",
        headers: strictHeaders,
      },
      {
        source: "/sheets-v2/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'self'; frame-src 'self' blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' ws: wss:; worker-src 'self' blob:",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
      {
        source: "/internal-editors/onlyoffice/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'self' https://sheets-v2.xenode.in; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'; worker-src 'self' blob:",
          },
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },

      {
        source: "/sync",
        headers: [
          { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
        ],
      },
      {
        source: "/admin/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
      // ── Blog: always serve fresh content, never cache in CDN/browser ──
      {
        source: "/blog",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, no-cache, must-revalidate, proxy-revalidate",
          },
          { key: "Pragma", value: "no-cache" },
        ],
      },
      {
        source: "/blog/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, no-cache, must-revalidate, proxy-revalidate",
          },
          { key: "Pragma", value: "no-cache" },
        ],
      },
      // ── Sitemap: short cache so search engines see new posts quickly ──
      {
        source: "/sitemap.xml",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
          },
        ],
      },
    ];
  },
};

const withMDX = createMDX({
  options: {
    remarkPlugins: [],
    rehypePlugins: [],
  },
});

export default withMDX(nextConfig);

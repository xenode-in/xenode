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
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
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

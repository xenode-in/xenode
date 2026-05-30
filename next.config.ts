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
        // ── ONLYOFFICE engine assets (served same-origin from public/onlyoffice) ──
        // Locked-down CSP so the vendored editor + x2t WASM can run but can make
        // NO cross-origin network requests — plaintext can never leave the device.
        // `wasm-unsafe-eval` is required to compile the x2t WASM; `connect-src
        // 'self'` lets the engine fetch only its own same-origin assets.
        source: "/onlyoffice/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // 'unsafe-eval' is REQUIRED by ONLYOFFICE: its template engine and
              // sdkjs compile code at runtime via new Function(). This does NOT
              // weaken the E2EE guarantee — that rests on `connect-src 'self'`
              // (no cross-origin egress), so the editor can run its own code but
              // can never exfiltrate decrypted bytes. 'wasm-unsafe-eval' stays for
              // the x2t WASM compile. Matches CryptPad's offline editor sandbox.
              "script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "font-src 'self' data:",
              // blob: lets the editor fetch the decrypted document we hand it as
              // an in-memory Blob URL (and its own image blobs). Still E2EE-safe:
              // blob: URLs are local/on-device, never a cross-origin destination.
              "connect-src 'self' blob:",
              "worker-src 'self' blob:",
              "child-src 'self' blob:",
              "object-src 'none'",
              "base-uri 'none'",
              "frame-ancestors 'self'",
            ].join("; "),
          },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        ],
      },
      {
        // Cache the LARGE, content-stable vendored dirs hard: each client
        // downloads the ~57MB x2t.wasm + sdkjs bundle ONCE, then every later
        // doc-open is served from disk cache (0 network bytes). The small glue
        // files (engine.js / editor.html / manifest.json) are deliberately NOT
        // listed here, so edits + engine upgrades take effect on reload; the
        // loader also fetches manifest.json with `cache: "no-cache"`.
        source: "/onlyoffice/:dir(sdkjs|web-apps|fonts|x2t)/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        // Fallback catch-all (excluding the public ones above)
        source: "/((?!plans|pricing|checkout).*)",
        headers: strictHeaders,
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

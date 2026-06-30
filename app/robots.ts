import { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  return {
    rules: [
      // ── Googlebot: full access to public pages, no crawl-delay needed ──
      {
        userAgent: "Googlebot",
        allow: ["/", "/blog/", "/pricing", "/changelog/", "/terms", "/privacy", "/login"],
        disallow: [
          "/api/",
          "/_next/",
          "/dashboard/",
          "/admin/",
          "/onboarding/",
          "/forgot-password",
          "/reset-password",
          "/shared/",
          "/album/",
          "/reference/",
        ],
      },

      // ── Bingbot: same as Googlebot ──────────────────────────────────────
      {
        userAgent: "Bingbot",
        allow: ["/", "/blog/", "/pricing", "/changelog/", "/terms", "/privacy", "/login"],
        disallow: [
          "/api/",
          "/_next/",
          "/dashboard/",
          "/admin/",
          "/onboarding/",
          "/forgot-password",
          "/reset-password",
          "/shared/",
          "/album/",
          "/reference/",
        ],
      },

      // ── Block AI training scrapers ───────────────────────────────────────
      {
        userAgent: "GPTBot",
        disallow: ["/"],
      },
      {
        userAgent: "ChatGPT-User",
        disallow: ["/"],
      },
      {
        userAgent: "CCBot",
        disallow: ["/"],
      },
      {
        userAgent: "anthropic-ai",
        disallow: ["/"],
      },
      {
        userAgent: "Claude-Web",
        disallow: ["/"],
      },
      {
        userAgent: "Omgilibot",
        disallow: ["/"],
      },
      {
        userAgent: "FacebookBot",
        allow: ["/", "/blog/", "/pricing", "/login"],
        disallow: ["/api/", "/_next/", "/dashboard/", "/admin/"],
      },

      // ── Default: all other bots ──────────────────────────────────────────
      {
        userAgent: "*",
        allow: ["/", "/blog/", "/pricing", "/changelog/", "/terms", "/privacy", "/login"],
        disallow: [
          "/api/",
          "/_next/",
          "/dashboard/",
          "/admin/",
          "/onboarding/",
          "/forgot-password",
          "/reset-password",
          "/shared/",
          "/album/",
          "/reference/",
        ],
        crawlDelay: 2,
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  };
}

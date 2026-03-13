import { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  return {
    rules: [
      {
        // Allow all bots to crawl public marketing pages only
        userAgent: "*",
        allow: ["/", "/blog/", "/pricing", "/changelog/"],
        disallow: [
          "/api/",
          "/_next/",
          "/dashboard/",
          "/admin/",
          "/onboarding/",
          "/login",
          "/register",
          "/forgot-password",
          "/reset-password",
          "/shared/",
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}

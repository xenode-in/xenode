import { MetadataRoute } from "next";
import { getAllPosts } from "@/lib/blog";
import { getAllChangelogEntries as getChangelogSlugs } from "@/lib/changelog";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  const [blogPosts, changelogEntries] = await Promise.all([
    getAllPosts(),
    Promise.resolve(getChangelogSlugs()),
  ]);

  const blogUrls: MetadataRoute.Sitemap = blogPosts.map((post) => ({
    url: `${baseUrl}/blog/${post.slug}`,
    lastModified: new Date(post.date),
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }));

  const changelogUrls: MetadataRoute.Sitemap = changelogEntries.map((entry) => ({
    url: `${baseUrl}/changelog/${entry.slug}`,
    lastModified: new Date(),
    changeFrequency: "weekly" as const,
    priority: 0.6,
  }));

  // Blog category/folder pages
  const blogCategoryUrls: MetadataRoute.Sitemap = [
    "announcements",
    "support",
    "updates",
    "guides",
    "security",
  ].map((folder) => ({
    url: `${baseUrl}/blog/${folder}`,
    lastModified: new Date(),
    changeFrequency: "weekly" as const,
    priority: 0.6,
  }));

  return [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: "daily" as const,
      priority: 1.0,
    },
    {
      url: `${baseUrl}/login`,
      lastModified: new Date(),
      changeFrequency: "yearly" as const,
      priority: 1.0,
    },
    {
      url: `${baseUrl}/pricing`,
      lastModified: new Date(),
      changeFrequency: "weekly" as const,
      priority: 0.9,
    },
    {
      url: `${baseUrl}/blog`,
      lastModified: blogPosts.length > 0
        ? new Date(blogPosts[0].date)
        : new Date(),
      changeFrequency: "daily" as const,
      priority: 0.8,
    },
    {
      url: `${baseUrl}/changelog`,
      lastModified: new Date(),
      changeFrequency: "weekly" as const,
      priority: 0.8,
    },
    {
      url: `${baseUrl}/terms`,
      lastModified: new Date("2025-01-01"),
      changeFrequency: "monthly" as const,
      priority: 0.3,
    },
    {
      url: `${baseUrl}/privacy`,
      lastModified: new Date("2025-01-01"),
      changeFrequency: "monthly" as const,
      priority: 0.3,
    },
    ...blogCategoryUrls,
    ...blogUrls,
    ...changelogUrls,
  ];
}

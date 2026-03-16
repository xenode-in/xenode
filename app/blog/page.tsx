import { Metadata } from "next";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { getAllPosts } from "@/lib/blog";
import { Calendar, Clock, User } from "lucide-react";
import { ThemeGradientBackground } from "@/components/ThemeGradientBackground";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export const metadata: Metadata = {
  title: "Blog",
  description:
    "Insights, security deep-dives, and product updates from the Xenode team.",
  alternates: {
    canonical: `${BASE_URL}/blog`,
  },
  openGraph: {
    type: "website",
    url: `${BASE_URL}/blog`,
    title: "Blog — Xenode",
    description:
      "Insights, security deep-dives, and product updates from the Xenode team.",
    images: [
      {
        url: `${BASE_URL}/og-image.png`,
        width: 1200,
        height: 630,
        alt: "Xenode Blog",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Blog — Xenode",
    description:
      "Insights, security deep-dives, and product updates from the Xenode team.",
    images: [`${BASE_URL}/og-image.png`],
  },
};

export default function BlogPage() {
  const posts = getAllPosts();

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: BASE_URL,
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Blog",
        item: `${BASE_URL}/blog`,
      },
    ],
  };

  return (
    <div className="relative min-h-screen flex flex-col font-sans bg-background text-foreground transition-colors duration-300">
      <ThemeGradientBackground />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(breadcrumbJsonLd),
        }}
      />

      {/* Grain overlay */}
      <div
        className="fixed inset-0 pointer-events-none z-20 contrast-200 bg-center bg-contain bg-fixed bg-repeat"
        style={{
          backgroundImage: "url('/grain.png')",
        }}
      />

      {/* Navigation */}
      <Navbar />

      {/* Main Content */}
      <main className="flex-1 relative z-10 px-8 py-12">
        <div className="max-w-[800px] mx-auto">
          <h1 className="text-4xl md:text-5xl font-semibold mb-4 text-foreground">Blog</h1>
          <p className="text-lg text-muted-foreground mb-12">
            Insights, updates, and technical deep-dives from the{" "}
            <span className="font-brand italic text-foreground">Xenode</span> team.
          </p>

          {posts.length === 0 ? (
            <div className="text-center py-16 bg-card rounded-xl border border-border">
              <p className="text-lg text-muted-foreground">
                No posts yet. Check back soon!
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {posts.map((post) => (
                <Link
                  key={post.slug}
                  href={`/blog/${post.slug}`}
                  className="block p-6 bg-card rounded-xl border border-border hover:bg-muted/30 hover:border-border/80 transition-all group"
                >
                  <div className="flex flex-wrap gap-2 mb-3">
                    {post.tags.map((tag) => (
                      <span
                        key={tag}
                        className="text-xs px-2 py-1 bg-primary/10 text-primary rounded-full"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                  <h2 className="text-2xl font-semibold mb-2 group-hover:text-primary transition-colors text-foreground">
                    {post.title}
                  </h2>
                  <p className="text-base text-muted-foreground mb-4">
                    {post.description}
                  </p>
                  <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <User className="w-4 h-4" />
                      {post.author}
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar className="w-4 h-4" />
                      {new Date(post.date).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="w-4 h-4" />
                      {post.readingTime}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 p-8 text-center text-sm opacity-60">
        <p>
          © 2026 <span className="font-brand italic">Xenode</span>. All rights
          reserved.
        </p>
      </footer>
    </div>
  );
}

import { Metadata } from "next";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { getAllPosts, BLOG_FOLDERS } from "@/lib/blog";
import { Calendar, Clock, User, FolderOpen, ArrowRight } from "lucide-react";
import Image from "next/image";
import { ThemeGradientBackground } from "@/components/ThemeGradientBackground";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export const revalidate = 60;

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
    title: "Blog | Xenode",
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
    title: "Blog | Xenode",
    description:
      "Insights, security deep-dives, and product updates from the Xenode team.",
    images: [`${BASE_URL}/og-image.png`],
  },
};

// Placeholder gradients per folder for the category cards
const FOLDER_GRADIENTS: Record<string, string> = {
  announcements: "from-blue-900/60 to-blue-700/30",
  support: "from-emerald-900/60 to-emerald-700/30",
  updates: "from-violet-900/60 to-violet-700/30",
  guides: "from-amber-900/60 to-amber-700/30",
  security: "from-red-900/60 to-red-700/30",
};

const FOLDER_ICON_COLORS: Record<string, string> = {
  announcements: "text-blue-400",
  support: "text-emerald-400",
  updates: "text-violet-400",
  guides: "text-amber-400",
  security: "text-red-400",
};

function getFolderGradient(folder: string) {
  return FOLDER_GRADIENTS[folder] ?? "from-zinc-900/60 to-zinc-700/30";
}

function getFolderIconColor(folder: string) {
  return FOLDER_ICON_COLORS[folder] ?? "text-zinc-400";
}

export default async function BlogPage() {
  const posts = await getAllPosts();

  // Folders with post counts (derived for the badges)
  const folderCounts = posts.reduce(
    (acc, post) => {
      if (post.folder) {
        acc[post.folder] = (acc[post.folder] || 0) + 1;
      }
      return acc;
    },
    {} as Record<string, number>,
  );

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: BASE_URL },
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
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />

      {/* Grain overlay */}
      <div
        className="fixed inset-0 pointer-events-none z-20 contrast-200 bg-center bg-contain bg-fixed bg-repeat"
        style={{ backgroundImage: "url('/grain.png')" }}
      />

      <Navbar />

      <main className="flex-1 relative z-10 px-8 py-12">
        <div className="max-w-[900px] mx-auto">
          {/* Hero */}
          <h1 className="text-4xl md:text-5xl font-semibold mb-4 text-foreground">
            Blog
          </h1>
          <p className="text-lg text-muted-foreground mb-14">
            Insights, updates, and technical deep-dives from the{" "}
            <span className="font-brand italic text-foreground">Xenode</span>{" "}
            team.
          </p>

          {/* ── Folders / Categories ─────────────────────────────── */}
          <section className="mb-24">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-6">
              Browse by Category
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {BLOG_FOLDERS.map((folder) => {
                const count = folderCounts[folder.slug] || 0;

                return (
                  <Link
                    key={folder.slug}
                    href={`/blog/${folder.slug}`}
                    className="group relative overflow-hidden rounded-lg border border-border bg-card aspect-[16/9] hover:border-border/60 transition-all duration-300 hover:shadow-xl"
                  >
                    {/* Image */}
                    {folder.image ? (
                      <Image
                        src={folder.image}
                        alt={folder.title}
                        fill
                        sizes="(max-width: 768px) 100vw, 50vw"
                        className="object-cover transition-transform duration-700 group-hover:scale-105"
                      />
                    ) : (
                      <div
                        className={`absolute inset-0 bg-gradient-to-br ${getFolderGradient(
                          folder.slug,
                        )}`}
                      />
                    )}

                    {/* Arrow */}
                    <div className="absolute bottom-6 right-6 opacity-0 group-hover:opacity-100 transition-all duration-300 translate-y-2 group-hover:translate-y-0">
                      <ArrowRight className="w-5 h-5 text-white/80" />
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
          {/* ── All Posts ────────────────────────────────────────── */}
          {posts.length === 0 ? (
            <div className="text-center py-16 bg-card rounded-xl border border-border">
              <p className="text-lg text-muted-foreground">
                No posts yet. Check back soon!
              </p>
            </div>
          ) : (
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground mb-6">
                Latest Posts
              </h2>

              <div className="space-y-8">
                {posts.map((post) => (
                  <Link
                    key={post.slug}
                    href={`/blog/${post.slug}`}
                    className="group block border border-border rounded-lg overflow-hidden hover:border-border/60 transition-all duration-300 hover:shadow-xl"
                  >
                    {/* Image */}
                    {post.image ? (
                      <div className="relative w-full aspect-[16/9] overflow-hidden">
                        <Image
                          src={post.image}
                          alt={post.title}
                          fill
                          sizes="100vw"
                          className="object-cover transition-transform duration-700 group-hover:scale-105"
                        />
                      </div>
                    ) : (
                      <div
                        className={`w-full aspect-[16/9] bg-gradient-to-br ${
                          post.folder
                            ? getFolderGradient(post.folder)
                            : "from-zinc-800 to-zinc-700"
                        }`}
                      />
                    )}

                    {/* Content */}
                    <div className="p-6">
                      {/* Tags */}
                      <div className="flex flex-wrap gap-2 mb-3">
                        {post.folder && (
                          <span className="text-xs px-2 py-0.5 bg-secondary text-secondary-foreground rounded-full capitalize">
                            {post.folder}
                          </span>
                        )}
                        {post.tags.map((tag) => (
                          <span
                            key={tag}
                            className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded-full"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>

                      {/* Title */}
                      <h3 className="text-xl md:text-2xl font-semibold mb-2 group-hover:text-primary transition-colors text-foreground leading-snug">
                        {post.title}
                      </h3>

                      {/* Description */}
                      <p className="text-sm md:text-base text-muted-foreground mb-4 line-clamp-2">
                        {post.description}
                      </p>

                      {/* Meta */}
                      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                        <span>{post.author}</span>
                        <span>
                          {new Date(post.date).toLocaleDateString("en-US", {
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                          })}
                        </span>
                        <span>{post.readingTime}</span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      </main>

      <footer className="relative z-10 p-8 text-center text-sm opacity-60">
        <p>
          © 2026 <span className="font-brand italic">Xenode</span>. All rights
          reserved.
        </p>
      </footer>
    </div>
  );
}

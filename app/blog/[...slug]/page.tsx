import { notFound } from "next/navigation";
import { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { MDXRemote } from "next-mdx-remote/rsc";
import { getPostBySlug, getAllSlugs, getAllPosts, BLOG_FOLDERS } from "@/lib/blog";
import { useMDXComponents } from "@/mdx-components";
import { Navbar } from "@/components/Navbar";
import {
  Calendar,
  Clock,
  User,
  FolderOpen,
  ArrowRight,
  ArrowLeft,
  PenSquare,
} from "lucide-react";
import remarkGfm from "remark-gfm";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export const revalidate = 60;

// Folder colour helpers (same palette as blog/page.tsx)
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
const folderGradient = (f: string) =>
  FOLDER_GRADIENTS[f] ?? "from-zinc-800/60 to-zinc-700/30";
const folderIconColor = (f: string) =>
  FOLDER_ICON_COLORS[f] ?? "text-zinc-400";

interface PageProps {
  params: Promise<{ slug: string[] }>;
}

export async function generateStaticParams() {
  const slugs = await getAllSlugs();

  const params: { slug: string[] }[] = slugs.map((s) => ({
    slug: s.split("/"),
  }));

  // Ensure hardcoded folders are included in static params
  for (const folder of BLOG_FOLDERS) {
    params.push({ slug: [folder.slug] });
  }

  return params;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const slugPath = slug.join("/");

  // Folder listing metadata
  if (slug.length === 1) {
    const hardcodedFolder = BLOG_FOLDERS.find(f => f.slug === slug[0]);
    if (hardcodedFolder) {
      return {
        title: `${hardcodedFolder.title} | Blog`,
        description: `Browse all ${hardcodedFolder.title} posts on Xenode.`,
        alternates: { canonical: `${BASE_URL}/blog/${slug[0]}` },
      };
    }
  }

  const post = await getPostBySlug(slug);
  if (!post) return { title: "Post Not Found" };

  const postUrl = `${BASE_URL}/blog/${slugPath}`;
  const ogImage = post.image
    ? post.image.startsWith("http")
      ? post.image
      : `${BASE_URL}${post.image}`
    : `${BASE_URL}/og-image.png`;

  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: postUrl },
    openGraph: {
      type: "article",
      url: postUrl,
      title: post.title,
      description: post.description,
      publishedTime: post.date,
      authors: [post.author],
      tags: post.tags,
      images: [{ url: ogImage, width: 1200, height: 630, alt: post.title }],
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.description,
      images: [ogImage],
    },
  };
}

export default async function BlogSlugPage({ params }: PageProps) {
  const { slug } = await params;

  // ── Folder listing logic ──────────────────────────────────────────
  const hardcodedFolder = BLOG_FOLDERS.find(f => f.slug === slug[0]);
  
  // If it's a single slug segment, it might be a folder
  if (slug.length === 1) {
    const allPosts = await getAllPosts();
    const folderPosts = allPosts.filter((p) => p.folder === slug[0]);
    
    // If it's either in BLOG_FOLDERS OR has posts, we show the folder listing
    if (hardcodedFolder || folderPosts.length > 0) {
      const folderName = slug[0];
      const folderLabel = hardcodedFolder?.title || folderName.charAt(0).toUpperCase() + folderName.slice(1);

      return (
        <div
          className="relative min-h-screen flex flex-col text-[#e8e4d9] font-sans force-dark"
          style={{
            background:
              "linear-gradient(268deg, #295d32 4.2%, #273f2c 98.63%)",
          }}
        >
          <div
            className="fixed inset-0 pointer-events-none z-20 contrast-200 bg-center bg-contain bg-fixed bg-repeat"
            style={{ backgroundImage: "url('/grain.png')" }}
          />
          <Navbar />

          <main className="flex-1 relative z-10 px-8 py-12">
            <div className="max-w-[800px] mx-auto">
              {/* Back */}
              <Link
                href="/blog"
                className="inline-flex items-center gap-1.5 text-sm opacity-60 hover:opacity-100 transition-opacity mb-8"
              >
                <ArrowLeft className="w-4 h-4" />
                All posts
              </Link>

              {/* Header */}
              <div className="flex items-center gap-3 mb-10">
                <div
                  className={`w-10 h-10 rounded-xl bg-gradient-to-br ${folderGradient(folderName)} flex items-center justify-center border border-white/10`}
                >
                  <FolderOpen
                    className={`w-5 h-5 ${folderIconColor(folderName)}`}
                  />
                </div>
                <div>
                  <h1 className="text-3xl md:text-4xl font-semibold capitalize">
                    {folderLabel}
                  </h1>
                  <p className="text-sm opacity-50 mt-0.5">
                    {folderPosts.length}{" "}
                    {folderPosts.length === 1 ? "post" : "posts"}
                  </p>
                </div>
              </div>

              {folderPosts.length === 0 ? (
                <div className="text-center py-24 rounded-2xl border border-white/5 bg-white/[0.02] backdrop-blur-sm">
                  <PenSquare className="w-10 h-10 mx-auto mb-4 opacity-20" />
                  <h2 className="text-xl font-medium opacity-80 mb-2">No posts yet</h2>
                  <p className="text-sm opacity-50 max-w-[300px] mx-auto">
                    We haven't published any articles in this category yet. Check back soon!
                  </p>
                  <Link
                    href="/blog"
                    className="mt-8 inline-flex items-center gap-2 px-5 py-2 rounded-full bg-white/10 hover:bg-white/20 text-sm transition-colors border border-white/10"
                  >
                    Return to Blog
                  </Link>
                </div>
              ) : (
                <div className="space-y-4">
                  {folderPosts.map((post) => (
                    <Link
                      key={post.slug}
                      href={`/blog/${post.slug}`}
                      className="flex gap-4 items-start p-5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 transition-all group"
                    >
                      {/* Thumbnail */}
                      {post.image ? (
                        <div className="relative w-20 h-20 flex-shrink-0 rounded-lg overflow-hidden border border-white/10">
                          <Image
                            src={post.image}
                            alt={post.title}
                            fill
                            className="object-cover group-hover:scale-105 transition-transform duration-500"
                          />
                        </div>
                      ) : (
                        <div
                          className={`w-20 h-20 flex-shrink-0 rounded-lg border border-white/10 bg-gradient-to-br ${folderGradient(folderName)} flex items-center justify-center`}
                        >
                          <FolderOpen
                            className={`w-5 h-5 ${folderIconColor(folderName)}`}
                          />
                        </div>
                      )}

                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap gap-1.5 mb-1.5">
                          {post.tags.map((tag) => (
                            <span
                              key={tag}
                              className="text-xs px-2 py-0.5 bg-white/10 text-white/70 rounded-full"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                        <h2 className="text-base font-semibold group-hover:text-[#7cb686] transition-colors leading-snug mb-1">
                          {post.title}
                        </h2>
                        <p className="text-sm opacity-60 line-clamp-2 mb-2">
                          {post.description}
                        </p>
                        <div className="flex flex-wrap items-center gap-3 text-xs opacity-50">
                          <span className="flex items-center gap-1">
                            <User className="w-3 h-3" /> {post.author}
                          </span>
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {new Date(post.date).toLocaleDateString("en-US", {
                              year: "numeric",
                              month: "short",
                              day: "numeric",
                            })}
                          </span>
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" /> {post.readingTime}
                          </span>
                        </div>
                      </div>

                      <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-60 transition-opacity mt-1 flex-shrink-0" />
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </main>

          <footer className="relative z-10 p-8 text-center text-sm opacity-40">
            <p>
              © 2026 <span className="font-brand italic">Xenode</span>. All
              rights reserved.
            </p>
          </footer>
        </div>
      );
    }
  }

  // ── Individual post logic ────────────────────────────────────────
  const post = await getPostBySlug(slug);
  if (!post) notFound();

  const components = useMDXComponents({});
  const postUrl = `${BASE_URL}/blog/${slug.join("/")}`;

  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.description,
    url: postUrl,
    datePublished: post.date,
    dateModified: post.date,
    author: { "@type": "Person", name: post.author },
    publisher: {
      "@type": "Organization",
      name: "Xenode",
      logo: {
        "@type": "ImageObject",
        url: `${BASE_URL}/icons/android-icon-192x192.png`,
      },
    },
    image: post.image
      ? {
          "@type": "ImageObject",
          url: post.image.startsWith("http")
            ? post.image
            : `${BASE_URL}${post.image}`,
        }
      : {
          "@type": "ImageObject",
          url: `${BASE_URL}/og-image.png`,
          width: 1200,
          height: 630,
        },
    keywords: post.tags.join(", "),
  };

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: BASE_URL },
      { "@type": "ListItem", position: 2, name: "Blog", item: `${BASE_URL}/blog` },
      ...(post.folder
        ? [
            {
              "@type": "ListItem",
              position: 3,
              name:
                post.folder.charAt(0).toUpperCase() + post.folder.slice(1),
              item: `${BASE_URL}/blog/${post.folder}`,
            },
            {
              "@type": "ListItem",
              position: 4,
              name: post.title,
              item: postUrl,
            },
          ]
        : [
            {
              "@type": "ListItem",
              position: 3,
              name: post.title,
              item: postUrl,
            },
          ]),
    ],
  };

  return (
    <div
      className="relative min-h-screen flex flex-col text-[#e8e4d9] font-sans force-dark"
      style={{
        background: "linear-gradient(268deg, #295d32 4.2%, #273f2c 98.63%)",
      }}
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />

      <div
        className="fixed inset-0 pointer-events-none z-20 contrast-200 bg-center bg-contain bg-fixed bg-repeat"
        style={{ backgroundImage: "url('/grain.png')" }}
      />

      <Navbar />

      <main className="flex-1 relative z-10 px-8 py-12">
        <article className="max-w-[720px] mx-auto">
          <header className="mb-10">
            {/* Breadcrumb */}
            <div className="flex items-center gap-2 mb-4">
              <Link
                href="/blog"
                className="text-sm opacity-60 hover:opacity-100 transition-opacity"
              >
                Blog
              </Link>
              {post.folder && (
                <>
                  <span className="opacity-40 text-sm">/</span>
                  <Link
                    href={`/blog/${post.folder}`}
                    className="flex items-center gap-1 text-sm px-2 py-0.5 bg-[#7cb686]/20 text-[#7cb686] rounded-full capitalize hover:bg-[#7cb686]/30 transition-colors"
                  >
                    <FolderOpen className="w-3 h-3" />
                    {post.folder}
                  </Link>
                </>
              )}
            </div>

            <div className="flex flex-wrap gap-2 mb-4">
              {post.tags.map((tag) => (
                <span
                  key={tag}
                  className="text-xs px-2 py-1 bg-[#7cb686]/20 text-[#7cb686] rounded-full"
                >
                  {tag}
                </span>
              ))}
            </div>

            <h1 className="text-4xl md:text-5xl font-semibold leading-tight mb-6">
              {post.title}
            </h1>
            <p className="text-xl opacity-70 mb-6">{post.description}</p>

            <div className="flex flex-wrap items-center gap-4 text-sm opacity-60 pb-6 border-b border-white/10">
              <span className="flex items-center gap-1">
                <User className="w-4 h-4" /> {post.author}
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
                <Clock className="w-4 h-4" /> {post.readingTime}
              </span>
            </div>
          </header>

          {post.image && (
            <div className="w-full h-72 md:h-96 relative mb-10 rounded-xl overflow-hidden border border-white/10">
              <Image
                src={post.image}
                alt={post.title}
                fill
                className="object-cover"
                priority
              />
            </div>
          )}

          <div className="prose prose-invert max-w-none">
            <MDXRemote
              source={post.content}
              components={components}
              options={{ mdxOptions: { remarkPlugins: [remarkGfm] } }}
            />
          </div>
        </article>
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

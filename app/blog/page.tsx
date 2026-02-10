import Link from "next/link";
import { getAllPosts } from "@/lib/blog";
import { ArrowLeft, Calendar, Clock, User } from "lucide-react";

export default function BlogPage() {
  const posts = getAllPosts();

  return (
    <div
      className="relative min-h-screen flex flex-col text-[#e8e4d9] font-sans"
      style={{
        background: "linear-gradient(268deg, #295d32 4.2%, #273f2c 98.63%)",
      }}
    >
      {/* Grain overlay */}
      <div
        className="fixed inset-0 pointer-events-none z-20 contrast-200 bg-center bg-contain bg-fixed bg-repeat"
        style={{
          backgroundImage: "url('/grain.png')",
        }}
      />

      {/* Navigation */}
      <nav className="relative z-10 px-8 py-6">
        <div className="max-w-[1200px] mx-auto flex justify-between items-center">
          <Link
            href="/"
            className="flex items-center gap-3 hover:opacity-80 transition-opacity"
          >
            <span className="text-3xl font-brand italic">Xenode</span>
          </Link>
          <div className="flex items-center gap-6">
            <Link
              href="/pricing"
              className="text-sm font-medium opacity-70 hover:opacity-100 transition-opacity"
            >
              Pricing
            </Link>
            <Link
              href="/changelog"
              className="text-sm font-medium opacity-70 hover:opacity-100 transition-opacity"
            >
              Changelog
            </Link>
            <Link
              href="/"
              className="flex items-center gap-2 text-sm opacity-70 hover:opacity-100 transition-opacity"
            >
              <ArrowLeft className="w-4 h-4" />
              Home
            </Link>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 relative z-10 px-8 py-12">
        <div className="max-w-[800px] mx-auto">
          <h1 className="text-4xl md:text-5xl font-semibold mb-4">Blog</h1>
          <p className="text-lg opacity-70 mb-12">
            Insights, updates, and technical deep-dives from the{" "}
            <span className="font-brand italic">Xenode</span> team.
          </p>

          {posts.length === 0 ? (
            <div className="text-center py-16 bg-white/5 rounded-xl border border-white/10">
              <p className="text-lg opacity-70">
                No posts yet. Check back soon!
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {posts.map((post) => (
                <Link
                  key={post.slug}
                  href={`/blog/${post.slug}`}
                  className="block p-6 bg-white/5 rounded-xl border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all group"
                >
                  <div className="flex flex-wrap gap-2 mb-3">
                    {post.tags.map((tag) => (
                      <span
                        key={tag}
                        className="text-xs px-2 py-1 bg-[#7cb686]/20 text-[#7cb686] rounded-full"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                  <h2 className="text-2xl font-semibold mb-2 group-hover:text-[#7cb686] transition-colors">
                    {post.title}
                  </h2>
                  <p className="text-base opacity-70 mb-4">
                    {post.description}
                  </p>
                  <div className="flex flex-wrap items-center gap-4 text-sm opacity-60">
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

import "./changelog.css";
import { Metadata } from "next";
import { Navbar } from "@/components/Navbar";
import { getAllChangelogs } from "@/lib/changelog";
import { MDXRemote } from "next-mdx-remote/rsc";
import remarkGfm from "remark-gfm";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export const metadata: Metadata = {
  title: "Changelog",
  description:
    "Every update to Xenode's encrypted storage platform. New features, fixes, and security improvements.",
  alternates: {
    canonical: `${BASE_URL}/changelog`,
  },
  openGraph: {
    type: "website",
    url: `${BASE_URL}/changelog`,
    title: "Changelog — Xenode",
    description:
      "Every update to Xenode's encrypted storage platform. New features, fixes, and security improvements.",
    images: [
      {
        url: `${BASE_URL}/og-image.png`,
        width: 1200,
        height: 630,
        alt: "Xenode Changelog",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Changelog — Xenode",
    description:
      "Every update to Xenode's encrypted storage platform.",
    images: [`${BASE_URL}/og-image.png`],
  },
};

export default async function ChangelogPage() {
  const changelogs = getAllChangelogs();

  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: BASE_URL },
      { "@type": "ListItem", position: 2, name: "Changelog", item: `${BASE_URL}/changelog` },
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
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />

      {/* Grain overlay */}
      <div
        className="fixed inset-0 pointer-events-none z-20 contrast-200 bg-center bg-contain bg-fixed bg-repeat"
        style={{ backgroundImage: "url('/grain.png')" }}
      />

      {/* Navigation */}
      <Navbar />

      {/* Main Content */}
      <main className="flex-1 relative z-10 px-8 py-12">
        <div className="max-w-[800px] mx-auto">
          <h1 className="text-4xl md:text-5xl font-semibold mb-4">Changelog</h1>
          <p className="text-lg opacity-70 mb-12">
            Every update to <span className="font-brand italic">Xenode</span>. Follow along as we build.
          </p>

          {changelogs.length === 0 ? (
            <div className="text-center py-16 bg-white/5 rounded-xl border border-white/10">
              <p className="text-lg opacity-70">No updates yet. Check back soon!</p>
            </div>
          ) : (
            <div className="space-y-12">
              {changelogs.map((entry) => (
                <div
                  key={entry.slug}
                  className="border-l-2 border-[#7cb686]/40 pl-6"
                >
                  <div className="flex flex-wrap items-center gap-3 mb-3">
                    <span className="text-xs px-2 py-1 bg-[#7cb686]/20 text-[#7cb686] rounded-full">
                      {entry.tag}
                    </span>
                    <span className="text-sm opacity-50">
                      {new Date(entry.date).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })}
                    </span>
                  </div>
                  <h2 className="text-2xl font-semibold mb-2">{entry.title}</h2>
                  <p className="opacity-70 mb-4">{entry.summary}</p>
                  <div className="prose prose-invert max-w-none prose-sm">
                    <MDXRemote
                      source={entry.content}
                      options={{ mdxOptions: { remarkPlugins: [remarkGfm] } }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 p-8 text-center text-sm opacity-60">
        <p>
          © 2026 <span className="font-brand italic">Xenode</span>. All rights reserved.
        </p>
      </footer>
    </div>
  );
}

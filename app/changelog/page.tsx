"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { Navbar } from "@/components/Navbar";
import { ChevronDown, ChevronUp } from "lucide-react";

interface ChangelogEntryMeta {
  slug: string;
  title: string;
  date: string;
  tag: string;
  summary: string;
  image?: string;
}

interface ChangelogGroup {
  label: string;
  entries: ChangelogEntryMeta[];
}

const TAG_COLORS: Record<string, { bg: string; text: string }> = {
  Feature: { bg: "rgba(124, 182, 134, 0.15)", text: "#7cb686" },
  Release: { bg: "rgba(130, 170, 255, 0.15)", text: "#82aaff" },
  Infrastructure: { bg: "rgba(255, 179, 71, 0.15)", text: "#ffb347" },
  Announcement: { bg: "rgba(200, 160, 255, 0.15)", text: "#c8a0ff" },
  Improvement: { bg: "rgba(100, 220, 200, 0.15)", text: "#64dcc8" },
  Update: { bg: "rgba(180, 180, 180, 0.15)", text: "#b4b4b4" },
};

function ChangelogEntry({
  entry,
  isFirst,
}: {
  entry: ChangelogEntryMeta;
  isFirst: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1, rootMargin: "0px 0px -50px 0px" },
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  const handleExpand = async () => {
    if (!isExpanded && !content) {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/changelog/${entry.slug}`);
        const data = await res.json();
        setContent(data.content);
      } catch {
        setContent("Failed to load content.");
      }
      setIsLoading(false);
    }
    setIsExpanded(!isExpanded);
  };

  const tagColor = TAG_COLORS[entry.tag] || TAG_COLORS.Update;
  const formattedDate = new Date(entry.date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  return (
    <div
      ref={ref}
      className={`group relative transition-all duration-700 ease-out ${
        isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
      }`}
    >
      {/* Timeline dot */}
      <div className="absolute left-0 top-[2px] hidden md:flex items-center justify-center">
        <div
          className={`w-[9px] h-[9px] rounded-full border-2 transition-colors duration-300 ${
            isFirst
              ? "bg-[#7cb686] border-[#7cb686] shadow-[0_0_8px_rgba(124,182,134,0.5)]"
              : "bg-transparent border-[#e8e4d9]/30 group-hover:border-[#7cb686] group-hover:bg-[#7cb686]/50"
          }`}
        />
      </div>

      {/* Entry content */}
      <div className="md:ml-8">
        {/* Date + Tag row */}
        <div className="flex items-center gap-3 mb-2">
          <span className="text-sm text-[#e8e4d9]/40 font-mono tracking-tight">
            {formattedDate}
          </span>
          <span
            className="text-[11px] font-semibold uppercase tracking-widest px-2.5 py-0.5 rounded-full"
            style={{
              backgroundColor: tagColor.bg,
              color: tagColor.text,
            }}
          >
            {entry.tag}
          </span>
        </div>

        {/* Title */}
        <h3 className="text-xl md:text-2xl font-semibold text-[#e8e4d9] mb-2 leading-tight">
          {entry.title}
        </h3>

        {/* Summary */}
        <p className="text-[15px] leading-relaxed text-[#e8e4d9]/60 mb-3 max-w-[600px]">
          {entry.summary}
        </p>

        {/* Hero image */}
        {entry.image && (
          <div className="mb-4 rounded-xl overflow-hidden border border-white/10 shadow-lg max-w-[640px]">
            <img
              src={entry.image}
              alt={entry.title}
              className="w-full h-auto object-cover"
              loading="lazy"
            />
          </div>
        )}

        {/* Expand/Collapse button */}
        <button
          onClick={handleExpand}
          className="flex items-center gap-1.5 text-[13px] font-medium text-[#7cb686]/80 hover:text-[#7cb686] transition-colors cursor-pointer group/btn"
        >
          {isExpanded ? (
            <>
              <ChevronUp className="w-3.5 h-3.5 transition-transform" />
              Show less
            </>
          ) : (
            <>
              <ChevronDown className="w-3.5 h-3.5 transition-transform group-hover/btn:translate-y-0.5" />
              Read more
            </>
          )}
        </button>

        {/* Expanded content */}
        <div
          className={`overflow-hidden transition-all duration-500 ease-in-out ${
            isExpanded ? "max-h-[2000px] opacity-100 mt-4" : "max-h-0 opacity-0"
          }`}
        >
          {isLoading ? (
            <div className="flex items-center gap-2 text-[#e8e4d9]/40 text-sm py-4">
              <div className="w-4 h-4 border-2 border-[#7cb686]/30 border-t-[#7cb686] rounded-full animate-spin" />
              Loading...
            </div>
          ) : content ? (
            <div
              className="changelog-content prose prose-invert max-w-none text-[#e8e4d9]/75 text-[15px] leading-relaxed"
              dangerouslySetInnerHTML={{ __html: content }}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function ChangelogPage() {
  const [groups, setGroups] = useState<ChangelogGroup[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/changelog")
      .then((res) => res.json())
      .then((data) => {
        setGroups(data.groups);
        setIsLoaded(true);
      })
      .catch(() => setIsLoaded(true));
  }, []);

  const totalEntries = useMemo(
    () => groups.reduce((sum, g) => sum + g.entries.length, 0),
    [groups],
  );

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
      <Navbar />

      {/* Header */}
      <header className="relative z-10 px-8 pt-8 pb-12 md:pt-12 md:pb-16">
        <div className="max-w-[800px] mx-auto">
          <div
            className={`transition-all duration-700 ease-out ${
              isLoaded ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
            }`}
          >
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-semibold tracking-tight mb-4">
              Changelog
            </h1>
            <p className="text-lg md:text-xl text-[#e8e4d9]/60 max-w-[520px] leading-relaxed">
              New updates and improvements to{" "}
              <span className="font-brand italic text-[#e8e4d9]/80">
                Xenode
              </span>
              . Follow along as we build.
            </p>
          </div>

          {/* Subtle divider */}
          <div
            className={`mt-10 h-px bg-linear-to-r from-[#e8e4d9]/20 via-[#e8e4d9]/10 to-transparent transition-all duration-1000 delay-300 ${
              isLoaded ? "opacity-100 scale-x-100" : "opacity-0 scale-x-0"
            } origin-left`}
          />
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 relative z-10 px-8 pb-20">
        <div className="max-w-[800px] mx-auto">
          {!isLoaded ? (
            /* Loading skeleton */
            <div className="space-y-12">
              {[1, 2, 3].map((i) => (
                <div key={i} className="animate-pulse">
                  <div className="h-4 w-32 bg-[#e8e4d9]/10 rounded mb-6" />
                  <div className="space-y-8">
                    <div>
                      <div className="h-3 w-20 bg-[#e8e4d9]/5 rounded mb-2" />
                      <div className="h-6 w-64 bg-[#e8e4d9]/10 rounded mb-2" />
                      <div className="h-4 w-full bg-[#e8e4d9]/5 rounded" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : totalEntries === 0 ? (
            <div className="text-center py-20 bg-white/5 rounded-2xl border border-white/10">
              <p className="text-lg text-[#e8e4d9]/50">
                No changelog entries yet. Check back soon!
              </p>
            </div>
          ) : (
            <div className="space-y-16">
              {groups.map((group) => (
                <section key={group.label}>
                  {/* Month header */}
                  <div className="flex items-center gap-4 mb-8">
                    <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-[#e8e4d9]/40 shrink-0">
                      {group.label}
                    </h2>
                    <div className="h-px flex-1 bg-[#e8e4d9]/10" />
                  </div>

                  {/* Entries with timeline */}
                  <div className="relative">
                    {/* Vertical timeline line */}
                    <div className="absolute left-[4px] top-[6px] bottom-4 w-px bg-[#e8e4d9]/10 hidden md:block" />

                    <div className="space-y-10">
                      {group.entries.map((entry, idx) => (
                        <ChangelogEntry
                          key={entry.slug}
                          entry={entry}
                          isFirst={idx === 0 && group === groups[0]}
                        />
                      ))}
                    </div>
                  </div>
                </section>
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

      {/* Changelog content styles */}
      <style jsx global>{`
        .changelog-content h2 {
          font-size: 1.15rem;
          font-weight: 600;
          color: rgba(232, 228, 217, 0.9);
          margin-top: 1.25rem;
          margin-bottom: 0.5rem;
        }
        .changelog-content h3 {
          font-size: 1.05rem;
          font-weight: 600;
          color: rgba(232, 228, 217, 0.85);
          margin-top: 1rem;
          margin-bottom: 0.4rem;
        }
        .changelog-content p {
          margin-bottom: 0.75rem;
          line-height: 1.7;
        }
        .changelog-content ul,
        .changelog-content ol {
          margin: 0.5rem 0 1rem 0;
          padding-left: 1.25rem;
        }
        .changelog-content ul {
          list-style-type: disc;
        }
        .changelog-content ol {
          list-style-type: decimal;
        }
        .changelog-content li {
          margin-bottom: 0.35rem;
          line-height: 1.6;
        }
        .changelog-content li strong {
          color: rgba(232, 228, 217, 0.85);
        }
        .changelog-content code {
          background: rgba(0, 0, 0, 0.3);
          padding: 0.15rem 0.4rem;
          border-radius: 4px;
          font-size: 0.85em;
          font-family:
            ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
          color: #7cb686;
        }
        .changelog-content pre {
          background: rgba(0, 0, 0, 0.4);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 0.75rem;
          padding: 1rem 1.25rem;
          overflow-x: auto;
          margin: 0.75rem 0 1rem;
        }
        .changelog-content pre code {
          background: none;
          padding: 0;
          color: rgba(232, 228, 217, 0.7);
          font-size: 0.85em;
          line-height: 1.6;
        }
        .changelog-content table {
          width: 100%;
          border-collapse: collapse;
          margin: 0.75rem 0 1rem;
          font-size: 0.9em;
        }
        .changelog-content th {
          text-align: left;
          padding: 0.5rem 1rem;
          border-bottom: 1px solid rgba(232, 228, 217, 0.15);
          color: rgba(232, 228, 217, 0.6);
          font-weight: 600;
          font-size: 0.85em;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .changelog-content td {
          padding: 0.4rem 1rem;
          border-bottom: 1px solid rgba(232, 228, 217, 0.06);
        }
        .changelog-content a {
          color: #7cb686;
          text-decoration: underline;
          text-underline-offset: 2px;
          transition: color 0.2s;
        }
        .changelog-content a:hover {
          color: #a5d4ad;
        }
        .changelog-content blockquote {
          border-left: 3px solid #7cb686;
          padding-left: 1rem;
          margin: 0.75rem 0;
          color: rgba(232, 228, 217, 0.55);
          font-style: italic;
        }
        .changelog-content hr {
          border: none;
          border-top: 1px solid rgba(232, 228, 217, 0.1);
          margin: 1.5rem 0;
        }
      `}</style>
    </div>
  );
}

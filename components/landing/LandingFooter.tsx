import Link from "next/link";
import { Github, Twitter } from "lucide-react";

const links = [
  { label: "Pricing", href: "/pricing" },
  { label: "Blog", href: "/blog" },
  { label: "Changelog", href: "/changelog" },
  { label: "Docs", href: "/docs" },
];

const legal = [
  { label: "Privacy Policy", href: "/privacy" },
  { label: "Terms of Service", href: "/terms" },
  { label: "Security", href: "/security" },
];

export function LandingFooter() {
  return (
    <footer className="relative z-10 border-t border-white/10 px-6 py-12">
      <div className="max-w-5xl mx-auto flex flex-col gap-10">
        {/* Top row */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
          {/* Brand */}
          <div className="flex flex-col gap-1">
            <span className="text-xl font-brand italic">
              Xenode
            </span>
            <span className="text-xs opacity-40">
              End-to-end encrypted cloud storage.
            </span>
          </div>

          {/* Nav links */}
          <nav className="flex flex-wrap gap-x-6 gap-y-2">
            {links.map((l) => (
              <Link
                key={l.label}
                href={l.href}
                className="text-sm opacity-50 hover:opacity-90 transition-opacity"
              >
                {l.label}
              </Link>
            ))}
          </nav>

          {/* Social */}
          <div className="flex items-center gap-4">
            <a
              href="https://github.com/santhoshkumar-dev/xnode"
              target="_blank"
              rel="noopener noreferrer"
              className="opacity-50 hover:opacity-90 transition-opacity"
              aria-label="GitHub"
            >
              <Github className="w-5 h-5" />
            </a>
            <a
              href="https://twitter.com"
              target="_blank"
              rel="noopener noreferrer"
              className="opacity-50 hover:opacity-90 transition-opacity"
              aria-label="Twitter"
            >
              <Twitter className="w-5 h-5" />
            </a>
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-white/10" />

        {/* Bottom row */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-xs opacity-40">
          <p>© 2026 <span className="font-brand italic">Xenode</span>. All rights reserved.</p>
          <nav className="flex gap-4">
            {legal.map((l) => (
              <Link key={l.label} href={l.href} className="hover:opacity-80 transition-opacity">
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </footer>
  );
}

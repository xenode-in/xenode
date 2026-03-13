import Link from "next/link";
import { Github, Twitter } from "lucide-react";
import { AnimatedLink } from "@/components/AnimatedLink";

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
    <footer className="relative z-10 border-t border-white/10 flex justify-center px-6 md:px-8">
      <div className="w-full max-w-[1200px] py-12 flex flex-col gap-10 px-6">
        {/* Top row */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
          {/* Brand */}
          <div className="flex flex-col gap-1">
            <span className="text-xl font-brand italic">Xenode</span>
            <span className="text-xs opacity-40">
              End-to-end encrypted cloud storage.
            </span>
          </div>

          {/* Nav links */}
          <nav className="flex flex-wrap gap-x-6 gap-y-2 group">
            {links.map((l) => (
              <AnimatedLink
                key={l.label}
                href={l.href}
                className="text-sm opacity-50 font-medium"
              >
                {l.label}
              </AnimatedLink>
            ))}
          </nav>

          {/* Social */}
          <div className="flex items-center gap-4">
            <a
              href="https://github.com/santhoshkumar-dev/Xenode"
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
          <p>
            © 2026 <span className="font-brand italic">Xenode</span>. All rights
            reserved.
          </p>
          <nav className="flex gap-4 group">
            {legal.map((l) => (
              <AnimatedLink
                key={l.label}
                href={l.href}
                className="font-medium opacity-50"
              >
                {l.label}
              </AnimatedLink>
            ))}
          </nav>
        </div>
      </div>
    </footer>
  );
}

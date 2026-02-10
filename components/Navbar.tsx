"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft } from "lucide-react";

export function Navbar() {
  const pathname = usePathname();
  const isHome = pathname === "/";
  const isBlog = pathname === "/blog";
  const isBlogPost = pathname?.startsWith("/blog/") && pathname !== "/blog";
  const isPricing = pathname === "/pricing";
  const isChangelog = pathname === "/changelog";

  return (
    <nav className="relative z-10 px-8 py-6">
      <div className="max-w-[1200px] mx-auto flex justify-between items-center">
        {isHome ? (
          <div className="flex items-center gap-3">
            <span className="text-3xl font-brand italic">Xenode</span>
          </div>
        ) : (
          <Link
            href="/"
            className="flex items-center gap-3 hover:opacity-80 transition-opacity"
          >
            <span className="text-3xl font-brand italic">Xenode</span>
          </Link>
        )}

        <div className="flex items-center gap-6">
          {isHome && (
            <>
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
                href="/blog"
                className="text-sm font-medium opacity-70 hover:opacity-100 transition-opacity"
              >
                Blog
              </Link>
            </>
          )}

          {isBlogPost && (
            <Link
              href="/blog"
              className="flex items-center gap-2 text-sm opacity-70 hover:opacity-100 transition-opacity"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Blog
            </Link>
          )}

          {(isPricing || isChangelog || isBlog) && (
            <>
              {!isPricing && (
                <Link
                  href="/pricing"
                  className="text-sm font-medium opacity-70 hover:opacity-100 transition-opacity"
                >
                  Pricing
                </Link>
              )}
              {!isChangelog && (
                <Link
                  href="/changelog"
                  className="text-sm font-medium opacity-70 hover:opacity-100 transition-opacity"
                >
                  Changelog
                </Link>
              )}
              {!isBlog && (
                <Link
                  href="/blog"
                  className="text-sm font-medium opacity-70 hover:opacity-100 transition-opacity"
                >
                  Blog
                </Link>
              )}
              <Link
                href="/"
                className="flex items-center gap-2 text-sm opacity-70 hover:opacity-100 transition-opacity"
              >
                <ArrowLeft className="w-4 h-4" />
                {isPricing ? "Back to Home" : "Home"}
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}

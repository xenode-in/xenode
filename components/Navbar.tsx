"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, Menu, X } from "lucide-react";
import { useState } from "react";

export function Navbar() {
  const pathname = usePathname();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const isHome = pathname === "/";
  const isBlog = pathname === "/blog";
  const isBlogPost = pathname?.startsWith("/blog/") && pathname !== "/blog";
  const isPricing = pathname === "/pricing";
  const isChangelog = pathname === "/changelog";

  const toggleMenu = () => setIsMenuOpen(!isMenuOpen);
  const closeMenu = () => setIsMenuOpen(false);

  // Shared navigation links logic to avoid duplication
  const NavLinks = ({ className = "" }: { className?: string }) => (
    <div className={className}>
      {isHome && (
        <>
          <Link
            href="/pricing"
            onClick={closeMenu}
            className="text-sm font-medium opacity-70 hover:opacity-100 transition-opacity"
          >
            Pricing
          </Link>
          <Link
            href="/changelog"
            onClick={closeMenu}
            className="text-sm font-medium opacity-70 hover:opacity-100 transition-opacity"
          >
            Changelog
          </Link>
          <Link
            href="/blog"
            onClick={closeMenu}
            className="text-sm font-medium opacity-70 hover:opacity-100 transition-opacity"
          >
            Blog
          </Link>
        </>
      )}

      {isBlogPost && (
        <Link
          href="/blog"
          onClick={closeMenu}
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
              onClick={closeMenu}
              className="text-sm font-medium opacity-70 hover:opacity-100 transition-opacity"
            >
              Pricing
            </Link>
          )}
          {!isChangelog && (
            <Link
              href="/changelog"
              onClick={closeMenu}
              className="text-sm font-medium opacity-70 hover:opacity-100 transition-opacity"
            >
              Changelog
            </Link>
          )}
          {!isBlog && (
            <Link
              href="/blog"
              onClick={closeMenu}
              className="text-sm font-medium opacity-70 hover:opacity-100 transition-opacity"
            >
              Blog
            </Link>
          )}
          <Link
            href="/"
            onClick={closeMenu}
            className="flex items-center gap-2 text-sm opacity-70 hover:opacity-100 transition-opacity"
          >
            <ArrowLeft className="w-4 h-4" />
            {isPricing ? "Back to Home" : "Home"}
          </Link>
        </>
      )}
    </div>
  );

  return (
    <nav className="relative z-50 px-6 py-4 md:px-8 md:py-6">
      <div className="max-w-[1200px] mx-auto flex justify-between items-center">
        {isHome ? (
          <div className="flex items-center gap-3">
            <span className="text-2xl md:text-3xl font-brand italic">
              Xenode
            </span>
          </div>
        ) : (
          <Link
            href="/"
            onClick={closeMenu}
            className="flex items-center gap-3 hover:opacity-80 transition-opacity"
          >
            <span className="text-2xl md:text-3xl font-brand italic">
              Xenode
            </span>
          </Link>
        )}

        {/* Desktop Menu */}
        <NavLinks className="hidden md:flex items-center gap-6" />

        {/* Mobile Menu Toggle */}
        <button
          className="md:hidden p-1 opacity-70 hover:opacity-100 transition-opacity"
          onClick={toggleMenu}
          aria-label="Toggle menu"
        >
          {isMenuOpen ? (
            <X className="w-6 h-6" />
          ) : (
            <Menu className="w-6 h-6" />
          )}
        </button>
      </div>

      {/* Mobile Menu Overlay */}
      {isMenuOpen && (
        <div className="absolute top-full left-0 right-0 border-b shadow-lg md:hidden p-6 animate-in slide-in-from-top-2">
          <NavLinks className="flex flex-col gap-4" />
        </div>
      )}
    </nav>
  );
}

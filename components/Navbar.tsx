"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, Menu, X } from "lucide-react";
import { useState } from "react";
import { motion } from "framer-motion";
import { AnimatedLink } from "@/components/AnimatedLink";

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
    <div className={`group ${className}`}>
      {isHome && (
        <>
          <AnimatedLink
            href="/changelog"
            onClick={closeMenu}
            className="text-sm font-medium opacity-70"
          >
            Changelog
          </AnimatedLink>
          <AnimatedLink
            href="/blog"
            onClick={closeMenu}
            className="text-sm font-medium opacity-70"
          >
            Blog
          </AnimatedLink>

          <AnimatedLink
            href="/pricing"
            onClick={closeMenu}
            className="text-sm font-medium opacity-70"
          >
            Pricing
          </AnimatedLink>

          <Link
            href="/login"
            onClick={closeMenu}
            className="text-sm text-[#2a5d33] font-medium px-5 py-2 rounded-sm border border-[#2a5d33]/20 bg-[#e4eac8] hover:bg-[#d4d9b8] hover:border-[#2a5d33]/40 transition-all duration-300 drop-shadow-sm flex items-center justify-center"
          >
            Login
          </Link>
        </>
      )}

      {isBlogPost && (
        <AnimatedLink
          href="/blog"
          onClick={closeMenu}
          className="flex items-center gap-2 text-sm opacity-70"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Blog
        </AnimatedLink>
      )}

      {(isPricing || isChangelog || isBlog) && (
        <>
          {!isPricing && (
            <AnimatedLink
              href="/pricing"
              onClick={closeMenu}
              className="text-sm font-medium opacity-70"
            >
              Pricing
            </AnimatedLink>
          )}
          {!isChangelog && (
            <AnimatedLink
              href="/changelog"
              onClick={closeMenu}
              className="text-sm font-medium opacity-70"
            >
              Changelog
            </AnimatedLink>
          )}
          {!isBlog && (
            <AnimatedLink
              href="/blog"
              onClick={closeMenu}
              className="text-sm font-medium opacity-70"
            >
              Blog
            </AnimatedLink>
          )}
          <AnimatedLink
            href="/"
            onClick={closeMenu}
            className="flex items-center gap-2 text-sm opacity-70"
          >
            <ArrowLeft className="w-4 h-4" />
            {isPricing ? "Back to Home" : "Home"}
          </AnimatedLink>
        </>
      )}
    </div>
  );

  return (
    <nav className="backdrop-blur-md border-b border-white/10 z-50 sticky top-0 px-6 md:px-8 flex justify-center">
      <div className="w-full max-w-[1200px] flex justify-between items-stretch px-6 md:px-8">
        <div className="flex items-center py-4 md:py-6">
          {isHome ? (
            <div className="flex items-center gap-3">
              <Link href="/" className="text-2xl md:text-3xl font-brand italic">
                Xenode
              </Link>
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
        </div>

        {/* Desktop Menu */}
        <div className="hidden md:flex items-center pl-6 border-l border-white/10">
          <NavLinks className="hidden md:flex items-center gap-6" />
        </div>

        {/* Mobile Menu Toggle */}
        <div className="md:hidden flex items-center justify-end">
          <button
            className="p-1 opacity-70 hover:opacity-100 transition-opacity"
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
      </div>

      {/* Mobile Menu Overlay */}
      {isMenuOpen && (
        <div className="absolute top-full left-0 right-0 border-b border-white/10 shadow-lg md:hidden p-6 animate-in slide-in-from-top-2 bg-background">
          <div className="flex flex-col gap-4">
            <NavLinks className="flex flex-col gap-4" />
          </div>
        </div>
      )}
    </nav>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, Menu, X, User } from "lucide-react";
import { useState, useEffect } from "react";
import { AnimatedLink } from "@/components/AnimatedLink";
import { MinimalThemeSelector } from "@/components/settings/minimal-theme-selector";
import { useSession } from "@/lib/auth/client";

export function Navbar() {
  const pathname = usePathname();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const { data: session, isPending } = useSession();

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
            className="text-sm font-medium text-foreground/70 hover:text-foreground"
          >
            Changelog
          </AnimatedLink>
          <AnimatedLink
            href="/blog"
            onClick={closeMenu}
            className="text-sm font-medium text-foreground/70 hover:text-foreground"
          >
            Blog
          </AnimatedLink>

          <AnimatedLink
            href="/pricing"
            onClick={closeMenu}
            className="text-sm font-medium text-foreground/70 hover:text-foreground"
          >
            Pricing
          </AnimatedLink>

          <div className="flex items-center gap-4 border-l border-border/50 pl-4 ml-2">
            <div className="hidden md:block">
              <MinimalThemeSelector />
            </div>

            {!isPending &&
              (session ? (
                <Link
                  href="/dashboard"
                  onClick={closeMenu}
                  className="text-sm text-primary-foreground font-medium px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 transition-all duration-300 drop-shadow-sm flex items-center gap-2 w-full"
                >
                  <User className="w-4 h-4" />
                  Dashboard
                </Link>
              ) : (
                <Link
                  href="/login"
                  onClick={closeMenu}
                  className="text-sm text-primary-foreground font-medium px-5 py-2 rounded-lg bg-primary hover:bg-primary/90 transition-all duration-300 drop-shadow-sm flex items-center justify-center"
                >
                  Login
                </Link>
              ))}
          </div>
        </>
      )}

      {isBlogPost && (
        <AnimatedLink
          href="/blog"
          onClick={closeMenu}
          className="text-sm text-foreground/70 hover:text-foreground"
        >
          <div className="flex gap-2 items-center">
            <ArrowLeft className="w-4 h-4" /> <span>Back to Blog</span>
          </div>
        </AnimatedLink>
      )}

      {(isPricing || isChangelog || isBlog) && (
        <>
          {!isPricing && (
            <AnimatedLink
              href="/pricing"
              onClick={closeMenu}
              className="text-sm font-medium text-foreground/70 hover:text-foreground"
            >
              Pricing
            </AnimatedLink>
          )}
          {!isChangelog && (
            <AnimatedLink
              href="/changelog"
              onClick={closeMenu}
              className="text-sm font-medium text-foreground/70 hover:text-foreground"
            >
              Changelog
            </AnimatedLink>
          )}
          {!isBlog && (
            <AnimatedLink
              href="/blog"
              onClick={closeMenu}
              className="text-sm font-medium text-foreground/70 hover:text-foreground"
            >
              Blog
            </AnimatedLink>
          )}

          <div className="flex items-center gap-4 border-l border-border/50 md:pl-4 md:ml-2">
            <div className="hidden md:block">
              <MinimalThemeSelector />
            </div>
            {!isPending &&
              (session ? (
                <Link
                  href="/dashboard"
                  onClick={closeMenu}
                  className="text-sm text-primary-foreground font-medium px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 transition-all duration-300 drop-shadow-sm flex items-center gap-2"
                >
                  <User className="w-4 h-4" />
                  Dashboard
                </Link>
              ) : (
                <Link
                  href="/login"
                  onClick={closeMenu}
                  className="text-sm text-primary-foreground font-medium px-5 py-2 rounded-lg bg-primary hover:bg-primary/90 transition-all duration-300 drop-shadow-sm flex items-center justify-center"
                >
                  Login
                </Link>
              ))}
          </div>
        </>
      )}
    </div>
  );

  return (
    <nav className="backdrop-blur-md border-b border-border z-50 sticky top-0 px-6 md:px-8 flex justify-center">
      <div className="w-full max-w-[1200px] flex justify-between items-stretch px-4">
        <div className="flex items-center py-4 md:py-6">
          {isHome ? (
            <div className="flex items-center gap-3">
              <Link
                href="/"
                className="text-2xl md:text-3xl font-brand italic text-foreground"
              >
                Xenode
              </Link>
            </div>
          ) : (
            <Link
              href="/"
              onClick={closeMenu}
              className="flex items-center gap-3 hover:opacity-80 transition-opacity text-foreground"
            >
              <span className="text-2xl md:text-3xl font-brand italic">
                Xenode
              </span>
            </Link>
          )}
        </div>

        {/* Desktop Menu */}
        <div className="hidden md:flex items-center pl-6">
          <NavLinks className="hidden md:flex items-center gap-6" />
        </div>

        {/* Mobile Menu Toggle */}
        <div className="md:hidden flex items-center gap-4 justify-end py-4">
          <MinimalThemeSelector />
          <button
            className="p-1 text-foreground/70 hover:text-foreground transition-colors"
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
        <div className="absolute top-full left-0 right-0 border-b border-border shadow-2xl md:hidden p-6 animate-in slide-in-from-top-2 bg-background">
          <div className="flex flex-col gap-4">
            <NavLinks className="flex flex-col gap-6" />
          </div>
        </div>
      )}
    </nav>
  );
}

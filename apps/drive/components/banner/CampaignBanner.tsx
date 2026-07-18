"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, X, ArrowRight } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface Props {
  name: string;
  discountPercent: number;
  badge: string;
  /** Unique key (e.g. campaign id or slug) so dismissals reset for new campaigns */
  campaignKey: string;
}

const STORAGE_PREFIX = "xenode-campaign-banner-dismissed:";

export default function CampaignBanner({
  name,
  discountPercent,
  badge,
  campaignKey,
}: Props) {
  // Hidden during SSR / first paint so we can read localStorage without flashing.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const wasDismissed =
      typeof window !== "undefined" &&
      localStorage.getItem(STORAGE_PREFIX + campaignKey) === "true";
    if (!wasDismissed) setVisible(true);
  }, [campaignKey]);

  const handleDismiss = () => {
    try {
      localStorage.setItem(STORAGE_PREFIX + campaignKey, "true");
    } catch {
      // ignore quota / private mode errors
    }
    setVisible(false);
  };

  return (
    <AnimatePresence initial={false}>
      {visible && (
        <motion.div
          key="campaign-banner"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          className="relative overflow-hidden"
        >
          <div className="relative bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600">
            {/* Animated shimmer sweep */}
            <motion.div
              aria-hidden
              initial={{ x: "-100%" }}
              animate={{ x: "100%" }}
              transition={{
                duration: 3.5,
                ease: "linear",
                repeat: Infinity,
                repeatDelay: 4,
              }}
              className="pointer-events-none absolute inset-y-0 w-1/3"
              style={{
                background:
                  "linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.18) 50%, transparent 70%)",
              }}
            />

            {/* Soft noise overlay for depth */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-[0.15] mix-blend-overlay"
              style={{
                backgroundImage:
                  "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
                backgroundSize: "200px 200px",
              }}
            />

            <div className="relative mx-auto flex max-w-7xl items-center justify-center gap-3 px-12 py-2.5 text-sm text-white">
              <Sparkles
                className="h-4 w-4 shrink-0 text-yellow-200"
                aria-hidden
              />

              <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
                <span className="rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider backdrop-blur-sm">
                  {badge}
                </span>
                <span className="font-semibold">{name}</span>
                <span className="text-white/80">—</span>
                <span>
                  Get{" "}
                  <span className="font-bold text-yellow-200">
                    {discountPercent}% off
                  </span>{" "}
                  all plans
                </span>
              </p>

              <Link
                href="/pricing"
                className={cn(
                  "group/cta inline-flex items-center gap-1 rounded-full bg-white/15 px-3 py-1",
                  "text-xs font-semibold backdrop-blur-sm transition-colors",
                  "hover:bg-white/25",
                )}
              >
                View plans
                <ArrowRight className="h-3 w-3 transition-transform group-hover/cta:translate-x-0.5" />
              </Link>
            </div>

            <button
              onClick={handleDismiss}
              aria-label="Dismiss campaign banner"
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-white/70 transition-colors hover:bg-white/15 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

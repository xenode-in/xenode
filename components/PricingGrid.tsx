"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useSession } from "@/lib/auth/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { IPlan } from "@/models/PricingConfig";
import type { BillingCycle } from "@/types/pricing";
import {
  getEffectivePriceForCycle,
  getYearlySavingsPercent,
} from "@/lib/pricing/pricingService";

interface HeadlineCampaign {
  name: string;
  discountPercent: number;
  badge: string;
}

interface Props {
  plans: IPlan[];
  campaign: HeadlineCampaign | null;
  compact?: boolean;
}

/**
 * Per-card visual theme — light + dark variants.
 *   - `cardClass`  — full-card vertical gradient + border (color carries through whole card)
 *   - `headerGlow` — blurred top-area gradient that simulates the fluid art graphic
 *   - `accent`     — colored check / accent text
 *
 * Real art assets can be dropped in as `<Image fill />` over the glow div later.
 */
const CARD_THEMES = [
  {
    cardClass:
      "bg-gradient-to-b from-blue-50 to-blue-100/40 border-blue-200/60 " +
      "dark:from-[#0e1530] dark:to-[#0a0d20] dark:border-[#1a2348]",
    headerGlow:
      "from-blue-400/50 via-indigo-400/30 to-transparent dark:from-blue-500/45 dark:via-indigo-500/25",
    accent: "text-blue-600 dark:text-blue-200",
  },
  {
    cardClass:
      "bg-gradient-to-b from-purple-50 to-pink-100/40 border-purple-200/60 " +
      "dark:from-[#1d1330] dark:to-[#2b1a40] dark:border-[#3a2450]",
    headerGlow:
      "from-pink-400/50 via-purple-400/35 to-transparent dark:from-pink-500/45 dark:via-purple-500/30",
    accent: "text-purple-600 dark:text-purple-200",
  },
  {
    cardClass:
      "bg-gradient-to-b from-teal-50 to-cyan-100/40 border-teal-200/60 " +
      "dark:from-[#0a1f25] dark:to-[#0a1820] dark:border-[#1a3038]",
    headerGlow:
      "from-teal-400/50 via-cyan-400/30 to-transparent dark:from-teal-500/45 dark:via-cyan-500/25",
    accent: "text-teal-600 dark:text-teal-200",
  },
  {
    cardClass:
      "bg-gradient-to-b from-emerald-50 to-green-100/40 border-emerald-200/60 " +
      "dark:from-[#0a1f17] dark:to-[#091812] dark:border-[#1a3028]",
    headerGlow:
      "from-emerald-400/50 via-[#7cb686]/35 to-transparent dark:from-emerald-500/45 dark:via-[#7cb686]/30",
    accent: "text-emerald-600 dark:text-[#7cb686]",
  },
];

const POPULAR_BUTTON =
  "bg-gradient-to-r from-pink-500 via-purple-500 to-indigo-500 text-white border-0 hover:opacity-90 shadow-md";
const DEFAULT_BUTTON =
  "bg-white/70 hover:bg-white text-gray-800 border border-gray-200 " +
  "dark:bg-white/5 dark:hover:bg-white/10 dark:text-gray-200 dark:border-white/10";

const PLAN_DESCRIPTIONS: Record<string, string> = {
  basic:
    "Essential encrypted storage for individuals exploring secure file sharing.",
  pro: "More space and advanced features for freelancers and small teams.",
  plus: "Advanced storage with priority support for growing teams.",
  max: "Maximum capacity with enterprise-grade security and access.",
};

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08, delayChildren: 0.15 } },
};

const cardVariants = {
  hidden: { opacity: 0, y: 28 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: "easeOut" as const },
  },
};

const CheckIcon = ({ className }: { className?: string }) => (
  <svg
    className={cn("w-4 h-4 flex-shrink-0", className)}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth="2"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    <circle cx="12" cy="12" r="10" />
  </svg>
);

export default function PricingGrid({
  plans,
  campaign,
  compact = false,
}: Props) {
  const router = useRouter();
  const { data: session } = useSession();
  const [cycle, setCycle] = useState<BillingCycle>("monthly");

  const handleSelectPlan = (slug: string) => {
    if (!session) {
      toast.error("Please sign in first to subscribe.");
      router.push("/login");
      return;
    }
    window.location.assign(`/checkout?plan=${slug}&cycle=${cycle}`);
  };

  const toggleSavings =
    plans.length > 0 ? getYearlySavingsPercent(plans[0].pricing) : null;

  return (
    <section className={cn("w-full", compact ? "px-4 pb-6" : "py-20 px-6")}>
      <div className={cn("mx-auto", compact ? "max-w-none" : "max-w-6xl")}>
        {/* Header */}
        {!compact && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, ease: "easeOut" }}
            className="mb-10 text-center"
          >
            <h2 className="mb-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Simple, Transparent Pricing
            </h2>
            <p className="mx-auto max-w-xl text-base text-muted-foreground">
              Secure your data with our End-to-End Encrypted (E2EE) platform.
              Choose the plan that fits your needs.
            </p>
          </motion.div>
        )}

        {/* Billing Cycle Toggle */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="flex justify-center mb-10"
        >
          <div className="relative inline-flex items-center gap-0.5 rounded-xl bg-muted border border-border p-1">
            {(["yearly", "monthly"] as BillingCycle[]).map((c) => (
              <button
                key={c}
                onClick={() => setCycle(c)}
                className={cn(
                  "relative flex items-center gap-2 px-5 py-1.5 rounded-lg text-sm font-semibold transition-colors duration-200 z-10",
                  cycle === c
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {cycle === c && (
                  <motion.div
                    layoutId="cycle-indicator"
                    className="absolute inset-0 bg-background rounded-lg shadow-sm"
                    style={{ zIndex: -1 }}
                    transition={{
                      type: "spring",
                      bounce: 0.15,
                      duration: 0.45,
                    }}
                  />
                )}
                <span className="relative">
                  {c === "yearly" ? "Annual" : "Monthly"}
                </span>
                {c === "yearly" && toggleSavings && toggleSavings > 0 && (
                  <span className="relative bg-foreground/10 text-foreground/80 text-[10px] font-semibold px-1.5 py-0.5 rounded-full">
                    Save {toggleSavings}%
                  </span>
                )}
              </button>
            ))}
          </div>
        </motion.div>

        {/* Plans Grid */}
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className={cn(
            "grid gap-5",
            compact
              ? "grid-cols-1 sm:grid-cols-2"
              : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
          )}
        >
          {plans.map((plan, idx) => {
            const theme = CARD_THEMES[idx % CARD_THEMES.length];
            const basePrice = getEffectivePriceForCycle(plan.pricing, cycle);
            const finalPrice = getEffectivePriceForCycle(
              plan.pricing,
              cycle,
              campaign?.discountPercent,
            );
            const isDiscounted = finalPrice !== basePrice;
            const isPop = plan.isPopular;
            const description =
              PLAN_DESCRIPTIONS[plan.slug] ??
              `${plan.storage} of secure E2EE storage.`;

            return (
              <motion.div
                key={plan.name}
                variants={cardVariants}
                whileHover={{ y: -8, transition: { duration: 0.3 } }}
                className={cn(
                  "group relative flex flex-col rounded-3xl border overflow-hidden",
                  "shadow-lg dark:shadow-2xl",
                  theme.cardClass,
                )}
              >
                {/* Top art glow — blurred gradient that suggests fluid art.
                    Replace with <Image fill /> as `absolute inset-x-0 top-0 h-40 z-[1]` later. */}
                <div
                  aria-hidden
                  className={cn(
                    "pointer-events-none absolute top-0 left-0 right-0 h-40 opacity-70 blur-2xl bg-gradient-to-b",
                    theme.headerGlow,
                  )}
                />

                {/* Save% badge — tab hanging from top */}
                {isDiscounted && (
                  <motion.div
                    initial={{ y: -8, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    transition={{ delay: 0.3, duration: 0.35 }}
                    className="absolute top-0 right-6 z-20 flex flex-col items-center bg-gray-900 dark:bg-black text-white text-xs font-semibold px-3 py-3 rounded-b-xl shadow-lg"
                  >
                    <span className="text-gray-400 text-[10px] leading-tight">
                      Save
                    </span>
                    <span className="leading-tight">
                      {campaign?.discountPercent}%
                    </span>
                  </motion.div>
                )}

                {/* Card body */}
                <div className="relative z-10 flex flex-col flex-1 p-7">
                  {/* Header info */}
                  <div className="mb-7 mt-4">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="text-xl font-medium text-gray-900 dark:text-white">
                        {plan.name}
                      </h3>
                      {isPop && (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/70 dark:bg-white/10 backdrop-blur-sm px-2 py-0.5 text-[10px] font-semibold text-gray-800 dark:text-white border border-gray-300/60 dark:border-white/15">
                          Popular
                        </span>
                      )}
                    </div>
                    <p className="text-[13px] text-gray-600 dark:text-gray-400 leading-relaxed min-h-[2.5rem]">
                      {description}
                    </p>
                  </div>

                  {/* Price */}
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={`${finalPrice}-${cycle}`}
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 6 }}
                      transition={{ duration: 0.18 }}
                      className="flex items-baseline gap-2 mb-6 flex-wrap"
                    >
                      {isDiscounted && (
                        <span className="text-sm text-gray-400 dark:text-gray-500 line-through">
                          ₹{basePrice}
                        </span>
                      )}
                      <span className="text-4xl font-semibold text-gray-900 dark:text-white tracking-tight">
                        ₹{finalPrice}
                      </span>
                      <span className="text-sm text-gray-500">
                        / {cycle === "yearly" ? "yearly" : "monthly"}
                      </span>
                    </motion.div>
                  </AnimatePresence>

                  {/* CTA — glassmorphism shimmer on hover */}
                  <button
                    onClick={() => handleSelectPlan(plan.slug)}
                    className={cn(
                      "relative w-full py-3 px-4 rounded-xl text-sm font-medium overflow-hidden mb-8",
                      "transition-all duration-300 active:scale-[0.98]",
                      isPop ? POPULAR_BUTTON : DEFAULT_BUTTON,
                    )}
                    style={{
                      backdropFilter: "blur(6px)",
                      WebkitBackdropFilter: "blur(6px)",
                    }}
                  >
                    {/* Shimmer sweep */}
                    <span
                      aria-hidden
                      className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-out pointer-events-none"
                      style={{
                        background:
                          "linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.35) 50%, transparent 70%)",
                      }}
                    />
                    <span className="relative">Get {plan.name}</span>
                  </button>

                  <hr className="border-t border-gray-200/70 dark:border-white/5 mb-7" />

                  {/* Features */}
                  <div className="flex-grow">
                    <h4 className="text-[15px] font-medium text-gray-900 dark:text-white mb-4">
                      Features
                    </h4>
                    <ul className="space-y-3">
                      {plan.features.map((feature, i) => (
                        <li
                          key={i}
                          className="flex items-start text-sm text-gray-700 dark:text-gray-300"
                        >
                          <CheckIcon
                            className={cn("mr-3 mt-0.5", theme.accent)}
                          />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </motion.div>

        {/* Footer note */}
        {!compact && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.7 }}
            className="mt-12 text-center text-xs text-muted-foreground"
          >
            All plans include End-to-End Encryption and a 14-day refund policy.
            You can cancel anytime from your billing page.
          </motion.p>
        )}
      </div>
    </section>
  );
}

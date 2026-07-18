"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/lib/auth/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { IPlan } from "@/models/PricingConfig";
import type { BillingCycle } from "@/types/pricing";
import {
  getEffectivePriceForCycle,
  getYearlySavingsPercent,
} from "@/lib/pricing/pricingService";

interface PlanPageCampaign {
  name: string;
  discountPercent: number;
  badge: string;
  discountDuration: "forever" | "limited";
  discountCycles: number | null;
}

const PLAN_WEIGHTS: Record<string, number> = {
  free: 0,
  basic: 1,
  pro: 2,
  plus: 3,
  max: 4,
  enterprise: 5,
};

/**
 * Per-card visual theme — light + dark variants.
 *   - `cardClass`  — full-card vertical gradient + border
 *   - `headerGlow` — blurred top-area gradient that simulates the fluid art graphic
 *   - `accent`     — colored check / accent text
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

function PlanSkeletons() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="rounded-3xl border border-border bg-card p-7 space-y-4"
        >
          <Skeleton className="h-40 w-full -mt-7 -mx-7 mb-3 rounded-none" />
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-11 w-full" />
          <div className="space-y-2 pt-2">
            {Array.from({ length: 4 }).map((_, j) => (
              <Skeleton key={j} className="h-3.5 w-full" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function PlansPageClient() {
  const router = useRouter();
  const { data: session } = useSession();
  const [plans, setPlans] = useState<IPlan[]>([]);
  const [campaign, setCampaign] = useState<PlanPageCampaign | null>(null);
  const [currentPlan, setCurrentPlan] = useState<string>("free");
  const [currentCycle, setCurrentCycle] = useState<BillingCycle>("monthly");
  const [isGracePeriod, setIsGracePeriod] = useState<boolean>(false);
  const [isPlanExpired, setIsPlanExpired] = useState<boolean>(false);
  const [hasActiveSubscription, setHasActiveSubscription] = useState(false);
  const [currentPeriodEnd, setCurrentPeriodEnd] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [cycle, setCycle] = useState<BillingCycle>("monthly");

  // Yearly→Monthly switch confirmation modal state.
  const [deferredSwitchPlan, setDeferredSwitchPlan] = useState<{
    slug: string;
    name: string;
  } | null>(null);
  const [deferredSwitchLoading, setDeferredSwitchLoading] = useState(false);

  useEffect(() => {
    fetch("/api/admin/pricing/plans-public")
      .then((r) => r.json())
      .then((data) => {
        if (data.plans) setPlans(data.plans);
        setCampaign(data.campaign ?? null);
        if (data.currentPlan) setCurrentPlan(data.currentPlan);
        if (data.currentCycle) {
          setCurrentCycle(data.currentCycle);
          setCycle(data.currentCycle);
        }
        if (data.isGracePeriod) setIsGracePeriod(data.isGracePeriod);
        if (data.isPlanExpired) setIsPlanExpired(data.isPlanExpired);
        setHasActiveSubscription(!!data.hasActiveSubscription);
        setCurrentPeriodEnd(data.currentPeriodEnd ?? null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // True when picking this plan@cycle would be a yearly→monthly switch on
  // an active subscription that we must defer to period end.
  const isDeferredYearlyToMonthly =
    hasActiveSubscription &&
    currentCycle === "yearly" &&
    cycle === "monthly" &&
    !isGracePeriod &&
    !isPlanExpired;

  const handleSelect = (slug: string, name: string) => {
    if (!session) {
      toast.error("Please sign in first.");
      router.push("/auth/login");
      return;
    }
    // Yearly users switching to monthly: deferred to period end. Open the
    // confirm modal instead of routing to checkout (which would 409 with an
    // existing active subscription anyway).
    if (isDeferredYearlyToMonthly) {
      setDeferredSwitchPlan({ slug, name });
      return;
    }
    window.location.assign(`/checkout?plan=${slug}&cycle=${cycle}`);
  };

  const confirmDeferredSwitch = async () => {
    if (!deferredSwitchPlan || deferredSwitchLoading) return;
    setDeferredSwitchLoading(true);
    try {
      const res = await fetch("/api/subscriptions/change-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newPlanSlug: deferredSwitchPlan.slug,
          newBillingCycle: "monthly",
          effective: "period_end",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to schedule plan change");
      }
      toast.success(
        data.effectiveAt
          ? `Switch to Monthly scheduled for ${new Date(data.effectiveAt).toLocaleDateString()}.`
          : "Switch to Monthly scheduled at end of your current period.",
      );
      setDeferredSwitchPlan(null);
      // Reload state so the UI reflects the scheduled change.
      router.push("/dashboard/billing");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setDeferredSwitchLoading(false);
    }
  };

  const toggleSavings =
    plans.length > 0 ? getYearlySavingsPercent(plans[0].pricing) : null;

  const visiblePlans = plans.filter(
    (plan) =>
      (PLAN_WEIGHTS[plan.slug] ?? 0) >= (PLAN_WEIGHTS[currentPlan] ?? 0),
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Sticky page header */}
      <div className="border-b border-border bg-background/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <span className="text-muted-foreground">/</span>
          <span className="text-sm font-medium text-foreground">Plans</span>
        </div>
      </div>

      <main className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        {/* Title */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: "easeOut" }}
          className="mb-4 text-center"
        >
          <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            Simple, transparent pricing
          </h1>
          <p className="mt-3 text-lg text-muted-foreground">
            No contracts. No surprise fees.
          </p>
        </motion.div>

        {/* Billing Cycle Toggle.
            Yearly users CAN preview monthly pricing and switch — but the
            switch is deferred to period end (industry-standard pattern;
            mirrored by the server in /api/subscriptions/change-plan). */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.12 }}
          className="flex flex-col items-center mt-8 mb-10 gap-2"
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
                    layoutId="plans-cycle-indicator"
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
          {isDeferredYearlyToMonthly && (
            <p className="text-xs text-muted-foreground text-center max-w-md mt-1">
              You&apos;re on an annual plan. Switching to Monthly will take
              effect at the end of your current period
              {currentPeriodEnd
                ? ` (${new Date(currentPeriodEnd).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })})`
                : ""}
              . You&apos;ll keep your annual benefits until then.
            </p>
          )}
        </motion.div>

        {/* Cards */}
        {loading ? (
          <PlanSkeletons />
        ) : plans.length === 0 ? (
          <p className="mt-20 text-center text-muted-foreground">
            No plans available.
          </p>
        ) : (
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className={cn(
              "grid gap-5 mx-auto",
              visiblePlans.length === 1 && "max-w-sm",
              visiblePlans.length === 2 &&
                "grid-cols-1 sm:grid-cols-2 max-w-3xl",
              visiblePlans.length === 3 &&
                "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 max-w-5xl",
              visiblePlans.length >= 4 &&
                "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
            )}
          >
            {visiblePlans.map((plan, idx) => {
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
              const isCurrentPlan =
                plan.slug === currentPlan &&
                cycle === currentCycle &&
                !isGracePeriod &&
                !isPlanExpired;
              const sameCycleAsCurrent =
                plan.slug === currentPlan && cycle === currentCycle;

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
                  {/* Top art glow */}
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
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <h3 className="text-xl font-medium text-gray-900 dark:text-white">
                          {plan.name}
                        </h3>
                        {isCurrentPlan ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 backdrop-blur-sm px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 border border-emerald-500/30">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            Active
                          </span>
                        ) : isPop ? (
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/70 dark:bg-white/10 backdrop-blur-sm px-2 py-0.5 text-[10px] font-semibold text-gray-800 dark:text-white border border-gray-300/60 dark:border-white/15">
                            <span className="h-1.5 w-1.5 rounded-full bg-purple-500 dark:bg-purple-300 animate-pulse" />
                            Popular
                          </span>
                        ) : null}
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
                      onClick={() => handleSelect(plan.slug, plan.name)}
                      disabled={isCurrentPlan}
                      className={cn(
                        "relative w-full py-3 px-4 rounded-xl text-sm font-medium overflow-hidden mb-8",
                        "transition-all duration-300 active:scale-[0.98]",
                        "disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100",
                        isPop ? POPULAR_BUTTON : DEFAULT_BUTTON,
                      )}
                      style={{
                        backdropFilter: "blur(6px)",
                        WebkitBackdropFilter: "blur(6px)",
                      }}
                    >
                      {!isCurrentPlan && (
                        <span
                          aria-hidden
                          className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-out pointer-events-none"
                          style={{
                            background:
                              "linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.35) 50%, transparent 70%)",
                          }}
                        />
                      )}
                      <span className="relative">
                        {sameCycleAsCurrent
                          ? isGracePeriod || isPlanExpired
                            ? "Renew Plan"
                            : "Current Plan"
                          : isDeferredYearlyToMonthly
                            ? plan.slug === currentPlan
                              ? "Schedule switch to Monthly"
                              : `Schedule ${plan.name} (Monthly)`
                            : plan.slug === currentPlan
                              ? `Switch to ${cycle === "yearly" ? "Annual" : "Monthly"}`
                              : `Get ${plan.name}`}
                      </span>
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
        )}

        {/* Footer note */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7 }}
          className="mt-12 text-center text-xs text-muted-foreground"
        >
          All plans include End-to-End Encryption and a 14-day refund policy.
          You can cancel anytime from your billing page.
        </motion.p>
      </main>

      {/* Confirmation modal: yearly user switching to monthly (deferred). */}
      {deferredSwitchPlan && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => !deferredSwitchLoading && setDeferredSwitchPlan(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-card border border-border shadow-xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-foreground">
              Switch to {deferredSwitchPlan.name} Monthly?
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Your current annual plan will continue as-is until it ends
              {currentPeriodEnd ? (
                <>
                  {" "}
                  on{" "}
                  <strong className="text-foreground">
                    {new Date(currentPeriodEnd).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                  </strong>
                </>
              ) : null}
              . After that, you&apos;ll move to {deferredSwitchPlan.name}{" "}
              Monthly billing.
            </p>

            <div className="mt-4 rounded-lg bg-muted/40 border border-border px-4 py-3 text-xs text-muted-foreground space-y-1">
              <p>
                <strong className="text-foreground">What this means:</strong>
              </p>
              <ul className="list-disc list-inside space-y-1 pl-1">
                <li>
                  You keep your annual plan and benefits until the end date
                  above.
                </li>
                <li>No refund is issued — you paid for the full year.</li>
                <li>
                  On the renewal date, you&apos;ll be charged monthly going
                  forward.
                </li>
                <li>
                  You can cancel the scheduled change anytime before it takes
                  effect.
                </li>
              </ul>
            </div>

            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeferredSwitchPlan(null)}
                disabled={deferredSwitchLoading}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeferredSwitch}
                disabled={deferredSwitchLoading}
                className="rounded-lg bg-foreground text-background px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50"
              >
                {deferredSwitchLoading ? "Scheduling…" : "Confirm switch"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

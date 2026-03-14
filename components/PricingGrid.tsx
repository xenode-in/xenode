/**
 * PricingGrid.tsx — Client component.
 *
 * Renders the pricing cards with a Monthly / Yearly billing toggle.
 * Uses pricingService pure functions for all price display logic.
 *
 * CHANGES (multi-cycle refactor):
 *  - Added BillingCycle toggle (Monthly / Yearly).
 *  - Reads price from plan.pricing[] via getEffectivePriceForCycle.
 *  - Shows "Save X%" badge on yearly toggle.
 *  - Passes ?cycle= param to /checkout route.
 */
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSession } from "@/lib/auth/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { IPlan } from "@/models/PricingConfig";
import type { BillingCycle } from "@/types/pricing";
import type { ActiveCampaign } from "@/lib/pricing/pricingService";
import {
  getEffectivePriceForCycle,
  getYearlySavingsPercent,
  getMonthlyEquivalentForYearly,
} from "@/lib/pricing/pricingService";

interface Props {
  plans: IPlan[];
  campaign: ActiveCampaign | null;
  compact?: boolean;
}

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
      router.push("/sign-in");
      return;
    }
    router.push(`/checkout?plan=${slug}&cycle=${cycle}`);
  };

  // Savings % shown on the Yearly toggle button (use first plan as reference)
  const toggleSavings =
    plans.length > 0 ? getYearlySavingsPercent(plans[0].pricing) : null;

  return (
    <section className={cn("w-full", compact ? "px-4 pb-6" : "py-20 px-6")}>
      <div className={cn("mx-auto", compact ? "max-w-none" : "max-w-5xl")}>

        {/* ── Header ─────────────────────────────────────────────── */}
        {!compact && (
          <div className="mb-10 text-center">
            <h2 className="mb-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Simple, Transparent Pricing
            </h2>
            <p className="mx-auto max-w-xl text-base text-muted-foreground">
              Secure your data with our End-to-End Encrypted (E2EE) platform.
              Choose the plan that fits your needs.
            </p>
          </div>
        )}

        {/* ── Billing Cycle Toggle ───────────────────────────────── */}
        <div className="flex justify-center mb-8">
          <div className="inline-flex items-center gap-1 rounded-xl bg-muted p-1 border border-border">
            <button
              onClick={() => setCycle("monthly")}
              className={cn(
                "px-5 py-1.5 rounded-lg text-sm font-semibold transition-all duration-200",
                cycle === "monthly"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Monthly
            </button>
            <button
              onClick={() => setCycle("yearly")}
              className={cn(
                "flex items-center gap-2 px-5 py-1.5 rounded-lg text-sm font-semibold transition-all duration-200",
                cycle === "yearly"
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Yearly
              {toggleSavings && toggleSavings > 0 && (
                <span className="bg-primary/15 text-primary text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                  Save {toggleSavings}%
                </span>
              )}
            </button>
          </div>
        </div>

        {/* ── Campaign Banner ────────────────────────────────────── */}
        {campaign && (
          <div className="mb-8 flex items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-5 py-3">
            <span className="text-sm font-semibold text-primary">
              {campaign.badge} {campaign.name} — {campaign.discountPercent}% off
              all plans!
            </span>
          </div>
        )}

        {/* ── Plans Grid ─────────────────────────────────────────── */}
        <div
          className={cn(
            "grid gap-5",
            compact
              ? "grid-cols-1 sm:grid-cols-2"
              : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
          )}
        >
          {plans.map((plan) => {
            // Get base price for selected cycle
            const basePrice = getEffectivePriceForCycle(
              plan.pricing,
              cycle
            );
            // Apply campaign discount on top if active
            const finalPrice = getEffectivePriceForCycle(
              plan.pricing,
              cycle,
              campaign?.discountPercent
            );
            const isDiscounted = finalPrice !== basePrice;

            // For yearly: show equivalent monthly cost
            const monthlyEquiv =
              cycle === "yearly"
                ? getMonthlyEquivalentForYearly(plan.pricing)
                : null;

            return (
              <div
                key={plan.name}
                className={cn(
                  "relative flex flex-col rounded-2xl border bg-card transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg",
                  compact ? "p-4" : "p-6",
                  plan.isPopular
                    ? "border-primary shadow-[0_0_0_1px_var(--color-primary),0_8px_32px_hsl(var(--primary)/0.18)] bg-primary/5"
                    : "border-border hover:border-primary/40",
                )}
              >
                {/* Popular badge */}
                {plan.isPopular && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                    <Badge className="bg-primary text-primary-foreground text-[11px] font-bold uppercase tracking-wider px-3 py-0.5 shadow-sm">
                      Most Popular
                    </Badge>
                  </div>
                )}

                {/* Plan title */}
                <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  {plan.storage} Plan
                </p>
                <h3 className="mb-4 text-xl font-bold text-foreground">
                  {plan.name}
                </h3>

                {/* Price */}
                <div className="mb-2 flex items-baseline gap-2">
                  <div>
                    {isDiscounted && (
                      <span className="text-sm line-through text-muted-foreground mr-1">
                        ₹{basePrice}
                      </span>
                    )}
                    <span
                      className={cn(
                        "text-4xl font-extrabold",
                        plan.isPopular ? "text-primary" : "text-foreground",
                      )}
                    >
                      ₹{finalPrice}
                    </span>
                    <span className="ml-1 text-sm text-muted-foreground">
                      /{cycle === "yearly" ? "yr" : "mo"}
                    </span>
                  </div>
                </div>

                {/* Yearly: show per-month equivalent */}
                {monthlyEquiv && (
                  <p className="mb-5 text-xs text-muted-foreground">
                    ₹{monthlyEquiv}/mo · billed annually
                  </p>
                )}

                {!monthlyEquiv && <div className="mb-5" />}

                {/* Features */}
                <ul className="mb-8 flex-1 space-y-2.5">
                  {plan.features.map((feature, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2.5 text-sm text-muted-foreground"
                    >
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>

                {/* CTA */}
                <Button
                  onClick={() => handleSelectPlan(plan.slug)}
                  variant={plan.isPopular ? "default" : "outline"}
                  className={cn(
                    "w-full font-semibold transition-all",
                    plan.isPopular && "shadow-md",
                  )}
                >
                  Get {plan.name}
                </Button>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

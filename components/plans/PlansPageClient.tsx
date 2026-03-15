"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/lib/auth/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { IPlan, ICampaign } from "@/models/PricingConfig";
import type { BillingCycle } from "@/types/pricing";
import {
  getEffectivePriceForCycle,
  getYearlySavingsPercent,
  getMonthlyEquivalentForYearly,
} from "@/lib/pricing/pricingService";

function PlanSkeletons() {
  return (
    <div className="flex items-end justify-center gap-4 px-4">
      {[false, false, true, false].map((pop, i) => (
        <div
          key={i}
          className={cn(
            "flex-1 max-w-[280px] rounded-2xl border border-border bg-card p-6 space-y-4",
            pop ? "py-10" : ""
          )}
        >
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-4 w-20" />
          <div className="space-y-2 pt-2">
            {Array.from({ length: 5 }).map((_, j) => (
              <Skeleton key={j} className="h-3.5 w-full" />
            ))}
          </div>
          <Skeleton className="h-11 w-full mt-4" />
        </div>
      ))}
    </div>
  );
}

export default function PlansPageClient() {
  const router = useRouter();
  const { data: session } = useSession();
  const [plans, setPlans] = useState<IPlan[]>([]);
  const [campaign, setCampaign] = useState<ICampaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [cycle, setCycle] = useState<BillingCycle>("monthly");

  useEffect(() => {
    fetch("/api/admin/pricing/plans-public")
      .then((r) => r.json())
      .then((data) => {
        if (data.plans) setPlans(data.plans);
        setCampaign(data.campaign ?? null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSelect = (slug: string) => {
    if (!session) {
      toast.error("Please sign in first.");
      router.push("/sign-in");
      return;
    }
    router.push(`/checkout?plan=${slug}&cycle=${cycle}`);
  };

  // Savings % for toggle badge (use first paid plan as reference)
  const toggleSavings =
    plans.length > 0 ? getYearlySavingsPercent(plans[0].pricing) : null;

  return (
    <div className="min-h-screen bg-background">
      {/* ── Page header ───────────────────────────────────── */}
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

      {/* ── Main content ──────────────────────────────────── */}
      <main className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        {/* Title */}
        <div className="mb-4 text-center">
          <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            Simple, transparent pricing
          </h1>
          <p className="mt-3 text-lg text-muted-foreground">
            No contracts. No surprise fees.
          </p>
        </div>

        {/* ── Billing Cycle Toggle ─────────────────────────── */}
        <div className="flex justify-center mt-8 mb-4">
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

        {/* Campaign banner */}
        {campaign && (
          <div className="mx-auto mb-10 flex max-w-lg items-center justify-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-5 py-2">
            <Zap className="h-3.5 w-3.5 text-primary" />
            <span className="text-sm font-semibold text-primary">
              {campaign.badge} {campaign.name} — {campaign.discountPercent}% off all plans!
            </span>
          </div>
        )}

        {/* Cards */}
        {loading ? (
          <div className="mt-10">
            <PlanSkeletons />
          </div>
        ) : plans.length === 0 ? (
          <p className="mt-20 text-center text-muted-foreground">No plans available.</p>
        ) : (
          <div className="mt-10 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-center">
            {plans.map((plan) => {
              const basePrice = getEffectivePriceForCycle(plan.pricing, cycle);
              const finalPrice = getEffectivePriceForCycle(
                plan.pricing,
                cycle,
                campaign?.discountPercent
              );
              const isDiscounted = finalPrice !== basePrice;
              const monthlyEquiv =
                cycle === "yearly"
                  ? getMonthlyEquivalentForYearly(plan.pricing)
                  : null;
              const pop = plan.isPopular;

              return (
                <div
                  key={plan.name}
                  className={cn(
                    "relative flex flex-col rounded-2xl border bg-card transition-all duration-200",
                    "w-full sm:flex-1 sm:max-w-[280px]",
                    pop ? "px-6 py-10 sm:-my-4" : "px-6 py-8",
                    pop
                      ? "border-primary shadow-[0_0_0_1px_hsl(var(--primary)/0.4),0_12px_48px_hsl(var(--primary)/0.18)] z-10"
                      : "border-border hover:border-primary/30 opacity-95 hover:opacity-100",
                    "hover:-translate-y-1 hover:shadow-xl",
                  )}
                >
                  {/* Popular badge */}
                  {pop && (
                    <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                      <Badge className="bg-primary text-primary-foreground text-[11px] font-bold uppercase tracking-widest px-4 py-1 rounded-full shadow">
                        Most Popular
                      </Badge>
                    </div>
                  )}

                  {/* Price */}
                  <div className="mb-1">
                    {isDiscounted && (
                      <span className="text-sm text-muted-foreground line-through mr-1.5">
                        ₹{basePrice}
                      </span>
                    )}
                    <span
                      className={cn(
                        "text-4xl font-extrabold tracking-tight",
                        pop ? "text-primary" : "text-foreground"
                      )}
                    >
                      ₹{finalPrice}
                    </span>
                    <span className="ml-1.5 text-sm text-muted-foreground">
                      /{cycle === "yearly" ? "yr" : "month"}
                    </span>
                  </div>

                  {/* Yearly per-month equivalent */}
                  {monthlyEquiv && (
                    <p className="mb-3 text-xs text-muted-foreground">
                      ₹{monthlyEquiv}/mo · billed annually
                    </p>
                  )}
                  {!monthlyEquiv && <div className="mb-3" />}

                  {/* Plan name */}
                  <h3 className="mb-2 text-xl font-bold text-foreground">{plan.name}</h3>

                  {/* Storage label */}
                  <p className="mb-5 text-sm text-muted-foreground">{plan.storage} E2EE storage</p>

                  {/* Features */}
                  <ul className="mb-8 flex-1 space-y-2.5">
                    {plan.features.map((f, i) => (
                      <li key={i} className="flex items-start gap-2.5 text-sm">
                        <span
                          className={cn(
                            "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full",
                            pop
                              ? "bg-primary/15 text-primary"
                              : "bg-muted text-muted-foreground"
                          )}
                        >
                          <Check className="h-2.5 w-2.5" />
                        </span>
                        <span className={pop ? "text-foreground" : "text-muted-foreground"}>
                          {f}
                        </span>
                      </li>
                    ))}
                  </ul>

                  {/* CTA */}
                  <Button
                    onClick={() => handleSelect(plan.slug)}
                    variant={pop ? "default" : "outline"}
                    className={cn("w-full h-11 font-semibold", pop && "shadow-md")}
                  >
                    {pop ? "Upgrade" : `Get ${plan.name}`}
                  </Button>
                </div>
              );
            })}
          </div>
        )}

        {/* Footer note */}
        <p className="mt-12 text-center text-xs text-muted-foreground">
          All plans include End-to-End Encryption. You can cancel anytime from your billing page.
        </p>
      </main>
    </div>
  );
}

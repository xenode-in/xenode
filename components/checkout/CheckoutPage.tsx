"use client";

import { useState } from "react";
import type { IPlan } from "@/models/PricingConfig";
import OrderSummary from "./OrderSummary";
import CheckoutForm from "./CheckoutForm";

export interface BillingAddress {
  name: string;
  line1: string;
  city: string;
  state: string;
  pin: string;
  country: string;
}

export interface CheckoutUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  billingAddress: BillingAddress | null;
}

export interface CheckoutPlan extends IPlan {
  originalPrice: number;
  campaignDiscount: number;
  campaignBadge: string | null;
  campaignDiscountPercent: number | null;
}

export interface CouponResult {
  couponId: string;
  code: string;
  discountAmount: number;
  discountLabel: string;
}

interface CheckoutPageProps {
  plan: CheckoutPlan;
  user: CheckoutUser;
  prorationCredit: number;
  finalAmount: number;
}

export default function CheckoutPage({
  plan,
  user,
  prorationCredit,
  finalAmount: serverFinalAmount,
}: CheckoutPageProps) {
  const [appliedCoupon, setAppliedCoupon] = useState<CouponResult | null>(null);

  const campaignPrice = plan.originalPrice - plan.campaignDiscount;
  const couponDiscount = appliedCoupon?.discountAmount ?? 0;
  const finalAmount = Math.max(1, campaignPrice - couponDiscount - prorationCredit);

  return (
    // No hardcoded theme class — inherits whatever theme the user has selected
    <div className="min-h-screen w-full bg-background">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <span className="font-brand text-lg font-bold tracking-tight text-foreground">
            xenode
          </span>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="inline-block h-2 w-2 rounded-full bg-primary" />
            Secure Checkout · 256-bit SSL
          </div>
        </div>
      </header>

      {/* Progress breadcrumb */}
      <div className="border-b border-border bg-muted/40">
        <div className="mx-auto flex h-9 max-w-5xl items-center gap-2 px-4 sm:px-6">
          <span className="text-xs font-medium text-primary">Cart</span>
          <span className="text-xs text-muted-foreground">/</span>
          <span className="text-xs font-semibold text-foreground">Payment</span>
          <span className="text-xs text-muted-foreground">/</span>
          <span className="text-xs text-muted-foreground">Confirmation</span>
        </div>
      </div>

      {/* Main */}
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:py-12">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
          {/* Left — form */}
          <section className="flex-1 min-w-0">
            <CheckoutForm
              plan={plan}
              user={user}
              prorationCredit={prorationCredit}
              finalAmount={finalAmount}
              onCouponChange={setAppliedCoupon}
              appliedCoupon={appliedCoupon}
            />
          </section>

          {/* Right — summary (sticky on desktop) */}
          <aside className="w-full lg:w-[360px] lg:shrink-0 lg:sticky lg:top-24">
            <OrderSummary
              plan={plan}
              prorationCredit={prorationCredit}
              finalAmount={finalAmount}
              appliedCoupon={appliedCoupon}
            />
          </aside>
        </div>
      </main>
    </div>
  );
}

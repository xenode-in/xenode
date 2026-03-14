/**
 * CheckoutPage.tsx
 *
 * CHANGES (multi-cycle refactor):
 *  - CheckoutPlan now carries `billingCycle` instead of the old scalar priceINR.
 *  - `originalPrice` is the cycle-specific base price (monthly or yearly).
 *  - Passes billingCycle down to CheckoutForm and OrderSummary.
 */
"use client";

import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import type { IPlan } from "@/models/PricingConfig";
import type { BillingCycle } from "@/types/pricing";
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
  /** The billing cycle selected on the pricing page */
  billingCycle: BillingCycle;
  /** Base price for this cycle (before campaign/coupon discounts) */
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
  finalAmount: _serverFinalAmount,
}: CheckoutPageProps) {
  const [appliedCoupon, setAppliedCoupon] = useState<CouponResult | null>(null);

  const campaignPrice = plan.originalPrice - plan.campaignDiscount;
  const couponDiscount = appliedCoupon?.discountAmount ?? 0;
  const finalAmount = Math.max(
    1,
    campaignPrice - couponDiscount - prorationCredit,
  );

  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      {/* ── Header ───────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <h1 className="text-2xl md:text-3xl font-brand italic tracking-tight text-foreground select-none">
            Xenode
          </h1>
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs text-muted-foreground">
              Secure Checkout · 256-bit SSL
            </span>
          </div>
        </div>
      </header>

      {/* ── Breadcrumb ───────────────────────────────────────────────── */}
      <div className="border-b border-border bg-muted/30">
        <div className="mx-auto flex h-9 max-w-5xl items-center gap-2 px-4 sm:px-6">
          <span className="text-xs text-muted-foreground">Cart</span>
          <span className="text-xs text-muted-foreground">/</span>
          <span className="text-xs font-semibold text-foreground">Payment</span>
          <span className="text-xs text-muted-foreground">/</span>
          <span className="text-xs text-muted-foreground">Confirmation</span>
        </div>
      </div>

      {/* ── Main ─────────────────────────────────────────────────────── */}
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:py-12">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
          {/* Payment form */}
          <section className="min-w-0 flex-1">
            <CheckoutForm
              plan={plan}
              user={user}
              prorationCredit={prorationCredit}
              finalAmount={finalAmount}
              onCouponChange={setAppliedCoupon}
              appliedCoupon={appliedCoupon}
            />
          </section>

          {/* Order summary — sticky on desktop */}
          <aside className="w-full lg:w-[360px] lg:shrink-0 lg:sticky lg:top-[88px]">
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

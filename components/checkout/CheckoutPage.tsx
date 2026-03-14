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

  // Recompute final amount client-side as coupon is applied/removed
  // Server will re-validate on submit — this is just for display
  const campaignPrice = plan.originalPrice - plan.campaignDiscount;
  const couponDiscount = appliedCoupon?.discountAmount ?? 0;
  const finalAmount = Math.max(1, campaignPrice - couponDiscount - prorationCredit);

  return (
    <div className="xenode-green min-h-screen w-full bg-background">
      <header className="border-b border-border px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <span className="font-brand text-lg font-bold tracking-tight text-foreground">xenode</span>
          <span className="text-xs text-muted-foreground">Secure Checkout · 256-bit SSL</span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-10">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
          <aside className="w-full lg:w-[380px] lg:shrink-0">
            <OrderSummary
              plan={plan}
              prorationCredit={prorationCredit}
              finalAmount={finalAmount}
              appliedCoupon={appliedCoupon}
            />
          </aside>
          <section className="flex-1">
            <CheckoutForm
              plan={plan}
              user={user}
              prorationCredit={prorationCredit}
              finalAmount={finalAmount}
              onCouponChange={setAppliedCoupon}
              appliedCoupon={appliedCoupon}
            />
          </section>
        </div>
      </main>
    </div>
  );
}

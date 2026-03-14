"use client";

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

/** IPlan extended with campaign pricing fields computed server-side */
export interface CheckoutPlan extends IPlan {
  /** Base price before any campaign discount */
  originalPrice: number;
  /** Discount amount in ₹ (0 if no active campaign) */
  campaignDiscount: number;
  /** Campaign badge text e.g. "🎉 Sale" (null if no campaign) */
  campaignBadge: string | null;
  /** Campaign discount % (null if no campaign) */
  campaignDiscountPercent: number | null;
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
  finalAmount,
}: CheckoutPageProps) {
  return (
    <div className="xenode-green min-h-screen w-full bg-background">
      {/* Top bar */}
      <header className="border-b border-border px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <span className="font-brand text-lg font-bold tracking-tight text-foreground">
            xenode
          </span>
          <span className="text-xs text-muted-foreground">
            Secure Checkout · 256-bit SSL
          </span>
        </div>
      </header>

      {/* Two-column layout */}
      <main className="mx-auto max-w-5xl px-4 py-10">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
          {/* LEFT — Order Summary */}
          <aside className="w-full lg:w-[380px] lg:shrink-0">
            <OrderSummary
              plan={plan}
              prorationCredit={prorationCredit}
              finalAmount={finalAmount}
            />
          </aside>

          {/* RIGHT — Payment Form */}
          <section className="flex-1">
            <CheckoutForm
              plan={plan}
              user={user}
              prorationCredit={prorationCredit}
              finalAmount={finalAmount}
            />
          </section>
        </div>
      </main>
    </div>
  );
}

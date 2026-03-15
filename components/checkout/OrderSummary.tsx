/**
 * OrderSummary.tsx
 *
 * CHANGES (multi-cycle refactor):
 *  - Reads billingCycle from plan prop.
 *  - Shows billing cycle label (Monthly / Yearly) in the summary.
 *  - For yearly: shows per-month equivalent and total savings vs monthly × 12.
 */
import { ShieldCheck, Lock } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import type { CheckoutPlan, CouponResult } from "./CheckoutPage";
import { getYearlySavingsPercent, getMonthlyEquivalentForYearly } from "@/lib/pricing/pricingService";

interface Props {
  plan: CheckoutPlan;
  prorationCredit: number;
  finalAmount: number;
  appliedCoupon: CouponResult | null;
}

const CYCLE_LABEL: Record<string, string> = {
  monthly: "Monthly",
  yearly: "Yearly",
  quarterly: "Quarterly",
  lifetime: "Lifetime",
};

export default function OrderSummary({
  plan,
  prorationCredit,
  finalAmount,
  appliedCoupon,
}: Props) {
  const campaignPrice = plan.originalPrice - plan.campaignDiscount;
  const couponDiscount = appliedCoupon?.discountAmount ?? 0;

  const isYearly = plan.billingCycle === "yearly";
  const monthlyEquiv = isYearly ? getMonthlyEquivalentForYearly(plan.pricing) : null;
  const yearlySavings = isYearly ? getYearlySavingsPercent(plan.pricing) : null;

  return (
    <div className="rounded-2xl border border-border bg-card p-6 space-y-4">
      <h2 className="text-base font-semibold text-foreground">Order Summary</h2>

      {/* Plan info */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium text-foreground">{plan.name}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {plan.storage} · {CYCLE_LABEL[plan.billingCycle] ?? plan.billingCycle} Billing
          </p>
          {monthlyEquiv && (
            <p className="text-xs text-muted-foreground">
              ₹{monthlyEquiv}/mo equivalent
            </p>
          )}
        </div>
        <span className="font-semibold text-foreground shrink-0">
          ₹{plan.originalPrice}
        </span>
      </div>

      <Separator />

      {/* Yearly savings callout */}
      {isYearly && yearlySavings && yearlySavings > 0 && (
        <div className="flex justify-between text-sm">
          <span className="text-primary font-medium">🎉 Yearly saving</span>
          <span className="text-primary font-semibold">−{yearlySavings}%</span>
        </div>
      )}

      {/* Campaign discount */}
      {plan.campaignDiscount > 0 && (
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">
            {plan.campaignBadge ?? "Campaign"} ({plan.campaignDiscountPercent}% off)
          </span>
          <span className="text-green-500 font-medium">−₹{plan.campaignDiscount}</span>
        </div>
      )}

      {/* Coupon discount */}
      {appliedCoupon && (
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">
            Coupon ({appliedCoupon.code})
          </span>
          <span className="text-green-500 font-medium">−₹{appliedCoupon.discountAmount}</span>
        </div>
      )}

      {/* Proration credit */}
      {prorationCredit > 0 && (
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Proration credit</span>
          <span className="text-green-500 font-medium">−₹{prorationCredit}</span>
        </div>
      )}

      <Separator />

      {/* Total */}
      <div className="flex justify-between font-bold text-base">
        <span className="text-foreground">Total due today</span>
        <span className="text-foreground">₹{finalAmount}</span>
      </div>

      {/* Trust signals */}
      <div className="flex flex-col gap-1.5 pt-1">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="w-3.5 h-3.5 text-primary" />
          End-to-End Encrypted Storage
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="w-3.5 h-3.5 text-primary" />
          Secure Payment via PayU
        </div>
      </div>
    </div>
  );
}

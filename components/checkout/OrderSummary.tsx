import { Zap } from "lucide-react";
import type { CheckoutPlan, CouponResult } from "./CheckoutPage";
import PriceBreakdown from "./PriceBreakdown";
import TrustBadges from "./TrustBadges";

interface OrderSummaryProps {
  plan: CheckoutPlan;
  prorationCredit: number;
  finalAmount: number;
  appliedCoupon: CouponResult | null;
}

export default function OrderSummary({
  plan,
  prorationCredit,
  finalAmount,
  appliedCoupon,
}: OrderSummaryProps) {
  const discountedPrice = plan.originalPrice - plan.campaignDiscount;
  const hasCampaign = plan.campaignDiscount > 0;

  return (
    <div className="space-y-4">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Order Summary
      </p>

      {/* Plan card */}
      <div className="rounded-xl border border-border bg-card p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {plan.storage} Plan
            </p>
            <div className="mt-1.5 flex items-baseline gap-2">
              {hasCampaign && (
                <span className="text-sm text-muted-foreground line-through">
                  ₹{plan.originalPrice}
                </span>
              )}
              <span className="text-2xl font-bold text-foreground">
                ₹{discountedPrice}
              </span>
              <span className="text-xs text-muted-foreground">/mo</span>
            </div>
            {hasCampaign && plan.campaignBadge && (
              <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5">
                <span className="text-xs font-semibold text-primary">
                  {plan.campaignBadge} · {plan.campaignDiscountPercent}% off
                </span>
              </div>
            )}
          </div>
          {plan.isPopular && (
            <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-semibold text-primary border border-primary/20">
              Popular
            </span>
          )}
        </div>

        {/* Features */}
        <ul className="space-y-1.5 border-t border-border pt-4">
          {plan.features.map((f) => (
            <li
              key={f}
              className="flex items-center gap-2 text-xs text-muted-foreground"
            >
              <span className="text-primary">✓</span>
              {f}
            </li>
          ))}
        </ul>
      </div>

      <PriceBreakdown
        planPrice={plan.originalPrice}
        campaignDiscount={plan.campaignDiscount}
        campaignBadge={plan.campaignBadge}
        couponDiscount={appliedCoupon?.discountAmount ?? 0}
        couponCode={appliedCoupon?.code ?? null}
        prorationCredit={prorationCredit}
        finalAmount={finalAmount}
      />

      <TrustBadges />
    </div>
  );
}

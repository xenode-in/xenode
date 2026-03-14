import type { CheckoutPlan, CouponResult } from "./CheckoutPage";
import PriceBreakdown from "./PriceBreakdown";
import TrustBadges from "./TrustBadges";

interface OrderSummaryProps {
  plan: CheckoutPlan;
  prorationCredit: number;
  finalAmount: number;
  appliedCoupon: CouponResult | null;
}

export default function OrderSummary({ plan, prorationCredit, finalAmount, appliedCoupon }: OrderSummaryProps) {
  const discountedPrice = plan.originalPrice - plan.campaignDiscount;
  const hasCampaign = plan.campaignDiscount > 0;

  return (
    <div className="space-y-4">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Order Summary</h2>

      <div className="rounded-xl border border-border bg-card p-6">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{plan.storage} Plan</p>
            <div className="mt-1 flex items-baseline gap-2">
              {hasCampaign && (
                <span className="text-sm text-muted-foreground line-through">₹{plan.originalPrice}</span>
              )}
              <h3 className="text-2xl font-bold text-foreground">
                ₹{discountedPrice}<span className="ml-1 text-sm font-normal text-muted-foreground">/mo</span>
              </h3>
            </div>
            {hasCampaign && plan.campaignBadge && (
              <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-400">
                {plan.campaignBadge} · {plan.campaignDiscountPercent}% off
              </span>
            )}
          </div>
          {plan.isPopular && (
            <span className="rounded-full bg-primary/20 px-2 py-0.5 text-xs font-semibold text-primary">Popular</span>
          )}
        </div>
        <ul className="space-y-2">
          {plan.features.map((f) => (
            <li key={f} className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="text-emerald-500">✓</span>{f}
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

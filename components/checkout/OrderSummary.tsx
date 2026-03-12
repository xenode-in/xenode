import type { PlanConfig } from "@/lib/config/plans";
import PriceBreakdown from "./PriceBreakdown";
import TrustBadges from "./TrustBadges";

interface OrderSummaryProps {
  plan: PlanConfig;
  prorationCredit: number;
  finalAmount: number;
}

export default function OrderSummary({ plan, prorationCredit, finalAmount }: OrderSummaryProps) {
  return (
    <div className="space-y-4">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Order Summary
      </h2>

      {/* Plan card */}
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {plan.storage} Plan
            </p>
            <h3 className="mt-1 text-2xl font-bold text-foreground">
              ₹{plan.priceINR}
              <span className="ml-1 text-sm font-normal text-muted-foreground">/mo</span>
            </h3>
          </div>
          {plan.isPopular && (
            <span className="rounded-full bg-primary/20 px-2 py-0.5 text-xs font-semibold text-primary">
              Popular
            </span>
          )}
        </div>

        {/* Features */}
        <ul className="space-y-2">
          {plan.features.map((f) => (
            <li key={f} className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="text-emerald-500">✓</span>
              {f}
            </li>
          ))}
        </ul>
      </div>

      {/* Price breakdown */}
      <PriceBreakdown
        planPrice={plan.priceINR}
        prorationCredit={prorationCredit}
        finalAmount={finalAmount}
      />

      {/* Trust badges */}
      <TrustBadges />
    </div>
  );
}

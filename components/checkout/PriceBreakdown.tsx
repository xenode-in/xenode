interface PriceBreakdownProps {
  planPrice: number;
  campaignDiscount: number;
  campaignBadge: string | null;
  couponDiscount: number;
  couponCode: string | null;
  prorationCredit: number;
  finalAmount: number;
}

export default function PriceBreakdown({
  planPrice,
  campaignDiscount,
  campaignBadge,
  couponDiscount,
  couponCode,
  prorationCredit,
  finalAmount,
}: PriceBreakdownProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Price Breakdown</p>
      <div className="space-y-2.5 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Plan price</span>
          <span className="text-foreground">₹{planPrice.toFixed(2)}</span>
        </div>
        {campaignDiscount > 0 && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">
              {campaignBadge ? `${campaignBadge} discount` : "Campaign discount"}
            </span>
            <span className="text-primary">− ₹{campaignDiscount.toFixed(2)}</span>
          </div>
        )}
        {couponDiscount > 0 && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">
              Coupon{couponCode ? ` (${couponCode})` : ""}
            </span>
            <span className="text-primary">− ₹{couponDiscount.toFixed(2)}</span>
          </div>
        )}
        {prorationCredit > 0 && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Proration credit</span>
            <span className="text-primary">− ₹{prorationCredit.toFixed(2)}</span>
          </div>
        )}
        <div className="border-t border-border pt-3">
          <div className="flex justify-between items-baseline">
            <span className="font-semibold text-foreground">Due today</span>
            <span className="text-xl font-bold text-foreground">₹{finalAmount.toFixed(2)}</span>
          </div>
          {prorationCredit > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              Includes ₹{prorationCredit.toFixed(2)} credit from your current plan.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

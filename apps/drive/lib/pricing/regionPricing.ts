import type { StorageRegion } from "@xenode/config/storage";
import type {
  BillingCurrency,
  IPlanPricing,
  RegionPrice,
} from "@/types/pricing";

/**
 * Region → billing currency. A user's immutable storage region (chosen at
 * onboarding) determines the currency and Razorpay plan they subscribe on.
 */
export const REGION_CURRENCY: Record<StorageRegion, BillingCurrency> = {
  asia: "INR",
  us: "USD",
  eu: "EUR",
};

export const CURRENCY_SYMBOL: Record<BillingCurrency, string> = {
  INR: "₹",
  USD: "$",
  EUR: "€",
};

/**
 * Resolve the price a given region pays for a plan/cycle. Asia is the default
 * region and derives from the canonical `priceINR` + `razorpayPlanId`; us/eu
 * come from the per-region overrides. Throws if a non-default region has no
 * configured price, so we never silently charge the wrong currency/amount.
 */
export function resolveRegionPricing(
  entry: IPlanPricing,
  region: StorageRegion,
): RegionPrice {
  if (region === "asia") {
    return {
      currency: "INR",
      amount: entry.priceINR,
      razorpayPlanId: entry.razorpayPlanId,
    };
  }
  const override = entry.regions?.[region];
  if (!override) {
    throw new Error(
      `No ${REGION_CURRENCY[region]} pricing configured for this plan/cycle`,
    );
  }
  return override;
}

/** Convert a major-unit amount (₹/$/€) to Razorpay minor units (paise/cents). */
export function toMinorUnits(amount: number): number {
  return Math.round(amount * 100);
}

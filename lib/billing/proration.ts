import type { BillingCycle } from "@/types/pricing";

/**
 * Proration math — pure functions, no DB. Used for plan-change pricing
 * previews and post-change credit notes.
 *
 * Razorpay's `subscriptions.update` does NOT prorate by itself (it either
 * applies the new plan from `cycle_end` or from `now` with no credit
 * computation). We keep proration calculations here so we can:
 *   1. Show the user "you'll get a ₹X credit" before they confirm.
 *   2. Record the credit in BillingEvent / Payment.metadata for accounting.
 *
 * The number returned here is informational unless/until we issue an actual
 * refund or credit note via Razorpay.
 */

const CYCLE_DAYS: Record<BillingCycle, number> = {
  monthly: 30,
  quarterly: 90,
  yearly: 365,
  lifetime: 36500, // effectively no proration for lifetime
};

export interface ProrationInputs {
  /** Current subscription's base price (INR, not paise) */
  currentPlanPriceINR: number;
  /** Current subscription's billing cycle */
  currentCycle: BillingCycle;
  /** When the current period started */
  currentPeriodStart: Date;
  /** When the current period ends */
  currentPeriodEnd: Date;
  /** New plan's base price for the new cycle (INR) */
  newPlanPriceINR: number;
  /** Now */
  now?: Date;
}

export interface ProrationResult {
  /** INR — credit for the unused portion of the current period. Always ≥ 0. */
  unusedCreditINR: number;
  /** INR — amount the new plan would charge for the equivalent remaining days. */
  newPlanChargeForRemainingINR: number;
  /** INR — net amount to charge today (newPlan - unusedCredit), ≥ 0. */
  netDueTodayINR: number;
  /** Fractional remaining days for transparency */
  daysRemaining: number;
  /** Total days in the current cycle */
  totalCycleDays: number;
}

export function calculateProration(args: ProrationInputs): ProrationResult {
  const now = args.now ?? new Date();

  const totalCycleDays = CYCLE_DAYS[args.currentCycle];
  const msRemaining = Math.max(
    0,
    args.currentPeriodEnd.getTime() - now.getTime(),
  );
  const daysRemaining = msRemaining / (1000 * 60 * 60 * 24);

  // Cap remaining days at the cycle length to handle weirdly-stamped subs.
  const cappedDaysRemaining = Math.min(daysRemaining, totalCycleDays);

  const dailyCurrent = args.currentPlanPriceINR / totalCycleDays;
  const dailyNew = args.newPlanPriceINR / totalCycleDays;

  const unusedCreditINR = Math.max(
    0,
    Math.round(dailyCurrent * cappedDaysRemaining),
  );
  const newPlanChargeForRemainingINR = Math.max(
    0,
    Math.round(dailyNew * cappedDaysRemaining),
  );
  const netDueTodayINR = Math.max(
    0,
    newPlanChargeForRemainingINR - unusedCreditINR,
  );

  return {
    unusedCreditINR,
    newPlanChargeForRemainingINR,
    netDueTodayINR,
    daysRemaining: cappedDaysRemaining,
    totalCycleDays,
  };
}

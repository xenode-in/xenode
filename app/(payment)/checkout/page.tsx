/**
 * app/(payment)/checkout/page.tsx — Server component.
 *
 * FIX (multi-cycle refactor):
 *   - Reads ?cycle= search param (defaults to "monthly" if omitted).
 *   - Uses getEffectivePriceForCycle() from pricingService instead of
 *     the removed plan.priceINR scalar — this was the NaN source.
 *   - Passes billingCycle into CheckoutPlan so CheckoutPage/OrderSummary
 *     can display the correct label and yearly savings line.
 */
import { redirect } from "next/navigation";
import { unstable_noStore as noStore } from "next/cache";
import { getServerSession } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import Usage from "@/models/Usage";
import mongoose from "mongoose";
import {
  getPlanBySlugFromDB,
  getPricingConfig,
} from "@/lib/config/getPricingConfig";
import {
  getEffectivePriceForCycle,
  resolveActiveCampaign,
} from "@/lib/pricing/pricingService";
import CheckoutPage from "@/components/checkout/CheckoutPage";
import type { BillingCycle } from "@/types/pricing";
import { getActiveSubscriptionOffer } from "@/lib/subscriptions/service";

export const metadata = {
  title: "Checkout | Xenode",
  robots: "noindex",
};

const VALID_CYCLES: BillingCycle[] = [
  "monthly",
  "yearly",
  "quarterly",
  "lifetime",
];

interface CheckoutPageProps {
  searchParams: Promise<{ plan?: string; cycle?: string }>;
}

export default async function Page({ searchParams }: CheckoutPageProps) {
  noStore();

  const params = await searchParams;
  const planSlug = params.plan;

  // Default to monthly if cycle param is missing or invalid
  const rawCycle = params.cycle as BillingCycle | undefined;
  const billingCycle: BillingCycle =
    rawCycle && VALID_CYCLES.includes(rawCycle) ? rawCycle : "monthly";

  const plan = planSlug ? await getPlanBySlugFromDB(planSlug) : undefined;
  if (!plan) redirect("/pricing");

  const [{ campaign }, activeSubscriptionOffer] = await Promise.all([
    getPricingConfig(),
    getActiveSubscriptionOffer(),
  ]);
  const activeCampaign = resolveActiveCampaign(campaign ?? null);

  // ── Server-authoritative price for this cycle ──────────────────────────────
  // getEffectivePriceForCycle throws if the cycle isn't configured for the plan.
  // We catch that and fall back to monthly so the page never shows NaN.
  let originalPrice: number;
  try {
    originalPrice = getEffectivePriceForCycle(plan.pricing, billingCycle);
  } catch {
    // Cycle not configured for this plan — fall back to monthly
    originalPrice = getEffectivePriceForCycle(plan.pricing, "monthly");
  }

  const campaignDiscount = activeCampaign
    ? Math.round(originalPrice * (activeCampaign.discountPercent / 100))
    : 0;
  const campaignPrice = originalPrice - campaignDiscount;

  // ── Auth ───────────────────────────────────────────────────────────────────
  const session = await getServerSession();
  if (!session?.user)
    redirect(`/sign-in?next=/checkout?plan=${planSlug}&cycle=${billingCycle}`);

  await dbConnect();
  const db = mongoose.connection.db;
  if (!db) redirect("/pricing");

  const userDoc = await db
    .collection("user")
    .findOne(
      { _id: new mongoose.Types.ObjectId(session.user.id) },
      { projection: { phone: 1, billingAddress: 1 } },
    );

  // ── Proration credit ───────────────────────────────────────────────────────
  const currentUsage = await Usage.findOne({ userId: session.user.id }).lean();
  let prorationCredit = 0;
  // eslint-disable-next-line react-hooks/purity
  const nowTs = Date.now();
  if (
    currentUsage &&
    currentUsage.plan !== "free" &&
    currentUsage.planExpiresAt &&
    new Date(currentUsage.planExpiresAt).getTime() > nowTs &&
    currentUsage.planPriceINR > 0 &&
    !currentUsage.isGracePeriod &&
    planSlug !== currentUsage.plan
  ) {
    const msRemaining =
      new Date(currentUsage.planExpiresAt).getTime() - nowTs;
    const daysRemaining = msRemaining / (1000 * 60 * 60 * 24);
    
    // Standard rounding to the nearest whole number (e.g., 349.97 -> 350)
    // Capped at the original price paid to prevent negative checkouts
    const calculatedCredit = Math.round((currentUsage.planPriceINR / 30) * daysRemaining);
    prorationCredit = Math.min(calculatedCredit, currentUsage.planPriceINR);
  }

  const finalAmount = Math.max(1, campaignPrice - prorationCredit);

  // Strip Mongoose-specific fields before passing across server→client boundary
  const { _id, __v, ...plainPlan } = plan as typeof plan & {
    _id?: unknown;
    __v?: unknown;
  };
  void _id;
  void __v;

  return (
    <CheckoutPage
      plan={{
        ...plainPlan,
        billingCycle,
        originalPrice,
        campaignDiscount,
        campaignBadge: activeCampaign?.badge ?? null,
        campaignDiscountPercent: activeCampaign?.discountPercent ?? null,
        subscriptionOffer:
          activeCampaign?.discountDuration === "limited" &&
          billingCycle !== "lifetime"
            ? {
                name: activeCampaign.name,
                discountPercent: activeCampaign.discountPercent,
                discountedAmount:
                  getEffectivePriceForCycle(
                    plan.pricing,
                    billingCycle,
                    activeCampaign.discountPercent,
                  ),
              }
            : activeSubscriptionOffer && activeSubscriptionOffer.originalAmount === originalPrice * 100
          ? {
              name: activeSubscriptionOffer.name,
              discountPercent: activeSubscriptionOffer.discountPercent,
              discountedAmount: activeSubscriptionOffer.discountedAmount / 100,
            }
          : null,
      }}
      user={{
        id: session.user.id,
        name: session.user.name || "",
        email: session.user.email || "",
        phone: userDoc?.phone || "",
        billingAddress: userDoc?.billingAddress || null,
      }}
      prorationCredit={prorationCredit}
      finalAmount={Math.round(finalAmount)}
    />
  );

}

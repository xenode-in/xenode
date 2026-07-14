/**
 * app/(payment)/checkout/page.tsx — Server component.
 *
 * Subscription-only checkout. Resolves authoritative pricing for the selected
 * plan + billing cycle, including any active campaign offer; coupon discounts
 * are applied client-side via CouponInput and validated server-side at
 * /api/subscriptions/create.
 */
import { redirect } from "next/navigation";
import { unstable_noStore as noStore } from "next/cache";
import { getServerSession } from "@/lib/auth/session";
import dbConnect from "@/lib/mongodb";
import mongoose from "mongoose";
import { getPlanBySlugFromDB } from "@/lib/config/getPricingConfig";
import { getEffectivePriceForCycle } from "@/lib/pricing/pricingService";
import CheckoutPage from "@/components/checkout/CheckoutPage";
import type { BillingCycle } from "@/types/pricing";
import { getActiveCampaign } from "@/lib/billing/campaigns";

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

  const rawCycle = params.cycle as BillingCycle | undefined;
  const billingCycle: BillingCycle =
    rawCycle && VALID_CYCLES.includes(rawCycle) ? rawCycle : "monthly";

  const plan = planSlug ? await getPlanBySlugFromDB(planSlug) : undefined;
  if (!plan) redirect("/pricing");

  let originalPrice: number;
  try {
    originalPrice = getEffectivePriceForCycle(plan.pricing, billingCycle);
  } catch {
    originalPrice = getEffectivePriceForCycle(plan.pricing, "monthly");
  }

  const activeCampaign = await getActiveCampaign({
    planSlug: plan.slug,
    cycle: billingCycle,
  });
  const campaignDiscount =
    activeCampaign && activeCampaign.discountPercent
      ? Math.round(originalPrice * (activeCampaign.discountPercent / 100))
      : 0;
  const campaignPrice = originalPrice - campaignDiscount;

  const session = await getServerSession();
  if (!session?.user)
    redirect(`/login?next=/checkout?plan=${planSlug}&cycle=${billingCycle}`);

  await dbConnect();
  const db = mongoose.connection.db;
  if (!db) redirect("/pricing");

  const userDoc = await db
    .collection("user")
    .findOne(
      { _id: new mongoose.Types.ObjectId(session.user.id) },
      { projection: { phone: 1, billingAddress: 1 } },
    );

  const finalAmount = Math.max(1, campaignPrice);

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
          activeCampaign &&
          activeCampaign.discountPercent &&
          billingCycle !== "lifetime"
            ? {
                name: activeCampaign.name,
                discountPercent: activeCampaign.discountPercent,
                discountedAmount: getEffectivePriceForCycle(
                  plan.pricing,
                  billingCycle,
                  activeCampaign.discountPercent,
                ),
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
      finalAmount={Math.round(finalAmount)}
    />
  );
}

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
import CheckoutPage from "@/components/checkout/CheckoutPage";

export const metadata = {
  title: "Checkout — Xenode",
  robots: "noindex",
};

interface CheckoutPageProps {
  searchParams: Promise<{ plan?: string }>;
}

export default async function Page({ searchParams }: CheckoutPageProps) {
  noStore();

  const params = await searchParams;
  const planSlug = params.plan;

  const plan = planSlug ? await getPlanBySlugFromDB(planSlug) : undefined;
  if (!plan) redirect("/pricing");

  const { campaign } = await getPricingConfig();
  const now = new Date();
  const activeCampaign =
    campaign?.isActive &&
    now >= new Date(campaign.startDate) &&
    now <= new Date(campaign.endDate)
      ? campaign
      : null;

  const originalPrice = plan.priceINR;
  const campaignDiscount = activeCampaign
    ? Math.round(originalPrice * (activeCampaign.discountPercent / 100))
    : 0;
  const campaignPrice = originalPrice - campaignDiscount;

  const session = await getServerSession();
  if (!session?.user) redirect(`/sign-in?next=/checkout?plan=${planSlug}`);

  await dbConnect();
  const db = mongoose.connection.db;
  if (!db) redirect("/pricing");

  const userDoc = await db
    .collection("user")
    .findOne(
      { _id: new mongoose.Types.ObjectId(session.user.id) },
      { projection: { phone: 1, billingAddress: 1 } }
    );

  const currentUsage = await Usage.findOne({ userId: session.user.id }).lean();
  let prorationCredit = 0;
  if (
    currentUsage &&
    currentUsage.plan !== "free" &&
    currentUsage.planExpiresAt &&
    new Date(currentUsage.planExpiresAt).getTime() > Date.now() &&
    currentUsage.planPriceINR > 0
  ) {
    const msRemaining =
      new Date(currentUsage.planExpiresAt).getTime() - Date.now();
    const daysRemaining = msRemaining / (1000 * 60 * 60 * 24);
    prorationCredit =
      Math.round((currentUsage.planPriceINR / 30) * daysRemaining * 100) / 100;
  }

  const finalAmount = Math.max(1, campaignPrice - prorationCredit);

  // Destructure out Mongoose-specific fields (_id, __v) that can't be
  // serialized across the server→client boundary (ObjectId has toJSON).
  const { _id, __v, ...plainPlan } = plan as typeof plan & { _id?: unknown; __v?: unknown };
  void _id; void __v;

  return (
    <CheckoutPage
      plan={{
        ...plainPlan,
        originalPrice,
        campaignDiscount,
        campaignBadge: activeCampaign?.badge ?? null,
        campaignDiscountPercent: activeCampaign?.discountPercent ?? null,
      }}
      user={{
        id: session.user.id,
        name: session.user.name || "",
        email: session.user.email || "",
        phone: userDoc?.phone || "",
        billingAddress: userDoc?.billingAddress || null,
      }}
      prorationCredit={prorationCredit}
      finalAmount={parseFloat(finalAmount.toFixed(2))}
    />
  );
}

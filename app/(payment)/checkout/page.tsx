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
  // Always read fresh pricing — never serve cached campaign state
  noStore();

  const params = await searchParams;
  const planSlug = params.plan;

  // Load plan from DB (slug lookup)
  const plan = planSlug ? await getPlanBySlugFromDB(planSlug) : undefined;
  if (!plan) redirect("/pricing");

  // Load campaign to compute discounted price
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

  // Guard: must be authenticated
  const session = await getServerSession();
  if (!session?.user) redirect(`/sign-in?next=/checkout?plan=${planSlug}`);

  await dbConnect();
  const db = mongoose.connection.db;
  if (!db) redirect("/pricing");

  // Fetch user profile for pre-fill
  const userDoc = await db
    .collection("user")
    .findOne(
      { _id: new mongoose.Types.ObjectId(session.user.id) },
      { projection: { phone: 1, billingAddress: 1 } }
    );

  // Calculate proration credit against the campaign price (what they'll actually pay)
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

  // Final amount = campaign price minus any proration credit, minimum ₹1
  const finalAmount = Math.max(1, campaignPrice - prorationCredit);

  return (
    <CheckoutPage
      plan={{
        ...plan,
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

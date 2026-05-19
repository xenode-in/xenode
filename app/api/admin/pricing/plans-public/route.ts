/**
 * Public API — serves live plans + headline campaign to client components.
 * Requires authenticated user session (not admin session).
 * Used by: UpgradePlanModal, OnboardingForm.
 *
 * Returns the highest-priority active Campaign (if any) so client components
 * can show discounted prices with strikethrough.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { getPricingConfig } from "@/lib/config/getPricingConfig";
import { getHeadlineCampaign } from "@/lib/billing/campaigns";
import Usage from "@/models/Usage";
import Payment from "@/models/Payment";
import dbConnect from "@/lib/mongodb";

export async function GET() {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await dbConnect();
  const usage = await Usage.findOne({ userId: session.user.id }).lean();
  const currentPlan = usage?.plan || "free";
  const isGracePeriod = usage?.isGracePeriod || false;
  const isPlanExpired = !!(usage?.planExpiresAt && new Date(usage.planExpiresAt).getTime() < Date.now());

  const lastPayment = await Payment.findOne({ userId: session.user.id, status: "success" })
    .sort({ createdAt: -1 })
    .select("billingCycle")
    .lean();
  const currentCycle = lastPayment?.billingCycle || "monthly";

  const [{ plans }, headline] = await Promise.all([
    getPricingConfig(),
    getHeadlineCampaign(),
  ]);

  // Headline campaign is shown unless its targetAudience excludes this user.
  const campaign =
    headline &&
    (headline.discountPercent ?? 0) > 0 &&
    headline.razorpayOfferId
      ? {
          name: headline.name,
          discountPercent: headline.discountPercent,
          badge: headline.badge,
          discountDuration: headline.duration,
          discountCycles: headline.cycles,
        }
      : null;

  return NextResponse.json({ plans, campaign, currentPlan, currentCycle, isGracePeriod, isPlanExpired });
}

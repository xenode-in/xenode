/**
 * Public API — serves live plans + active campaign to client components.
 * Requires authenticated user session (not admin session).
 * Used by: UpgradePlanModal, OnboardingForm.
 *
 * Returns campaign so client components can show discounted prices.
 * Base prices are always included so clients can show strikethrough.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "@/lib/auth/session";
import { getPricingConfig } from "@/lib/config/getPricingConfig";
import Usage from "@/models/Usage";
import dbConnect from "@/lib/mongodb";

export async function GET() {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await dbConnect();
  const usage = await Usage.findOne({ userId: session.user.id }).lean();
  const currentPlan = usage?.plan || "free";

  const { plans, campaign } = await getPricingConfig();

  // Only surface the campaign if it's actually active and within date range
  const now = new Date();
  const activeCampaign =
    campaign?.isActive &&
    now >= new Date(campaign.startDate) &&
    now <= new Date(campaign.endDate) &&
    (campaign.targetAudience === "all" || (campaign.targetAudience === "free_only" && currentPlan === "free"))
      ? campaign
      : null;

  return NextResponse.json({ plans, campaign: activeCampaign, currentPlan });
}

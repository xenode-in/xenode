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
import Subscription from "@/models/Subscription";
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

  // Surface the active subscription's period end so the plans page can show
  // "Switches to Monthly on <date>" when a yearly user picks Monthly. Only
  // manageable subscriptions count — cancelled/expired ones aren't a context
  // for plan changes.
  const activeSub = await Subscription.findOne({
    userId: session.user.id,
    status: { $nin: ["cancelled", "completed", "expired"] },
  })
    .sort({ createdAt: -1 })
    .select("current_period_end endDate subscription_id status")
    .lean();
  const hasActiveSubscription = !!activeSub?.subscription_id;
  const currentPeriodEnd = activeSub
    ? activeSub.current_period_end?.toISOString() ??
      activeSub.endDate?.toISOString() ??
      null
    : null;

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

  return NextResponse.json({
    plans,
    campaign,
    currentPlan,
    currentCycle,
    isGracePeriod,
    isPlanExpired,
    hasActiveSubscription,
    currentPeriodEnd,
  });
}

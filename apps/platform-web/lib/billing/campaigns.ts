import dbConnect from "@/lib/mongodb";
import Campaign, { type ICampaign } from "@/models/Campaign";
import type { BillingCycle } from "@/types/pricing";

/**
 * CampaignService — resolves which campaign (if any) applies to a checkout
 * context. Single source of truth: the `Campaign` collection.
 */

export interface ResolveArgs {
  planSlug: string;
  cycle: BillingCycle;
  userPlanSlug?: string | null;
  now?: Date;
}

export interface ResolvedCampaign {
  id: string;
  slug: string;
  name: string;
  discountPercent: number | null;
  flatDiscountPaise: number | null;
  badge: string;
  duration: "forever" | "limited";
  cycles: number | null;
  razorpayOfferId: string | null;
  priority: number;
}

function applies(
  campaign: ICampaign,
  args: ResolveArgs,
  now: Date,
): boolean {
  if (!campaign.isActive) return false;
  if (now < new Date(campaign.startsAt)) return false;
  if (now > new Date(campaign.endsAt)) return false;

  if (
    campaign.maxRedemptions != null &&
    campaign.redeemedCount >= campaign.maxRedemptions
  ) {
    return false;
  }

  if (
    campaign.applicablePlans.length > 0 &&
    !campaign.applicablePlans.includes(args.planSlug)
  ) {
    return false;
  }
  if (
    campaign.applicableCycles.length > 0 &&
    !campaign.applicableCycles.includes(args.cycle)
  ) {
    return false;
  }

  const audience = campaign.targetAudience;
  if (audience === "free_only") {
    if (args.userPlanSlug && args.userPlanSlug !== "free") return false;
  } else if (audience.startsWith("plan:")) {
    const required = audience.slice("plan:".length);
    if (args.userPlanSlug !== required) return false;
  }
  return true;
}

function toResolved(c: ICampaign): ResolvedCampaign {
  return {
    id: c._id.toString(),
    slug: c.slug,
    name: c.name,
    discountPercent: c.discountPercent,
    flatDiscountPaise: c.flatDiscountPaise,
    badge: c.badge,
    duration: c.duration,
    cycles: c.cycles,
    razorpayOfferId: c.razorpayOfferId,
    priority: c.priority,
  };
}

/**
 * Returns the highest-priority (lowest priority number) matching campaign,
 * or null if none. Ties broken by `endsAt` ascending (campaigns ending sooner
 * are surfaced first so we don't miss expiring offers).
 */
export async function resolveActiveCampaignFromCollection(
  args: ResolveArgs,
): Promise<ResolvedCampaign | null> {
  await dbConnect();
  const now = args.now ?? new Date();

  const candidates = await Campaign.find({
    isActive: true,
    startsAt: { $lte: now },
    endsAt: { $gte: now },
  })
    .sort({ priority: 1, endsAt: 1 })
    .limit(20)
    .exec();

  for (const c of candidates) {
    if (applies(c, args, now)) return toResolved(c);
  }
  return null;
}

/**
 * Active-campaign resolution for a given (plan, cycle, user) combination.
 * Reads the `Campaign` collection — the single source of truth.
 */
export async function getActiveCampaign(args: {
  planSlug: string;
  cycle: BillingCycle;
  userPlanSlug?: string | null;
  now?: Date;
}): Promise<ResolvedCampaign | null> {
  return resolveActiveCampaignFromCollection(args);
}

/**
 * Returns the highest-priority active campaign for marketing display, regardless
 * of which plan/cycle it targets. Used by the public pricing page to surface a
 * single "Sale" badge across plan cards.
 */
export async function getHeadlineCampaign(
  now: Date = new Date(),
): Promise<ResolvedCampaign | null> {
  await dbConnect();

  const candidate = await Campaign.findOne({
    isActive: true,
    startsAt: { $lte: now },
    endsAt: { $gte: now },
  })
    .sort({ priority: 1, endsAt: 1 })
    .exec();

  return candidate ? toResolved(candidate) : null;
}

/**
 * Increment redeemedCount atomically. Caller is responsible for only invoking
 * this once per actual redemption (e.g. on `subscription.charged`).
 */
export async function incrementCampaignRedemption(
  campaignId: string,
): Promise<void> {
  await dbConnect();
  await Campaign.updateOne(
    { _id: campaignId },
    { $inc: { redeemedCount: 1 } },
  );
}

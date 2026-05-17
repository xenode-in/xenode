import dbConnect from "@/lib/mongodb";
import Campaign, { type ICampaign } from "@/models/Campaign";
import type { BillingCycle } from "@/types/pricing";

/**
 * CampaignService — resolves which campaign (if any) applies to a checkout
 * context. Reads the dedicated Campaign collection; routes that previously
 * depended on `PricingConfig.campaign` should call `resolveActiveCampaign()`
 * in `lib/pricing/pricingService.ts` which falls back to the legacy field
 * when no Campaign rows match.
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
 * Unified active-campaign resolution: tries the `Campaign` collection first,
 * then falls back to the legacy `PricingConfig.campaign` embedded field. Use
 * this from any route that needs the currently-active campaign for a given
 * (plan, cycle, user) combination.
 *
 * The fallback path will be removed in v1.1 once admin tooling has been used
 * to migrate live campaigns into the collection.
 */
export async function getActiveCampaign(args: {
  planSlug: string;
  cycle: BillingCycle;
  userPlanSlug?: string | null;
  legacyCampaign?: {
    isActive: boolean;
    startDate: Date;
    endDate: Date;
    discountPercent: number;
    name: string;
    badge: string;
    discountDuration?: "forever" | "limited";
    discountCycles?: number | null;
    targetAudience?: "all" | "free_only";
  } | null;
  now?: Date;
}): Promise<ResolvedCampaign | null> {
  const now = args.now ?? new Date();

  const fromCollection = await resolveActiveCampaignFromCollection({
    planSlug: args.planSlug,
    cycle: args.cycle,
    userPlanSlug: args.userPlanSlug,
    now,
  });
  if (fromCollection) return fromCollection;

  // DEPRECATED: remove after v1.1
  const legacy = args.legacyCampaign;
  if (!legacy || !legacy.isActive) return null;
  if (now < new Date(legacy.startDate) || now > new Date(legacy.endDate)) {
    return null;
  }
  const audience = legacy.targetAudience ?? "all";
  if (
    audience === "free_only" &&
    args.userPlanSlug &&
    args.userPlanSlug !== "free"
  ) {
    return null;
  }
  return {
    id: "legacy",
    slug: "legacy",
    name: legacy.name,
    discountPercent: legacy.discountPercent,
    flatDiscountPaise: null,
    badge: legacy.badge,
    duration: legacy.discountDuration ?? "forever",
    cycles: legacy.discountCycles ?? null,
    razorpayOfferId: null,
    priority: 100,
  };
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

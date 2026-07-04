import mongoose from "mongoose";
import dbConnect from "@/lib/mongodb";
import Subscription from "@/models/Subscription";
import OrgUsage, {
  ORG_FREE_SEATS,
  ORG_FREE_TIER_LIMIT_BYTES,
} from "@/models/OrgUsage";
import { orgStorageOwnerId } from "@/lib/orgs/storage";
import { getOrgPlanBySlug, ORG_FREE_PLAN_SLUG } from "./orgPlans";

export type OrgSubscriptionStatus =
  | "none"
  | "active"
  | "past_due"
  | "halted"
  | "cancelled";

/**
 * The ONLY writer of `OrgUsage.plan` / `storageLimitBytes` / `seats` — the org
 * analogue of `syncUserSubscriptionState`. Called from the webhook state machine
 * (via `routeSubscriptionSync`) and from org billing API ops. Does NOT touch the
 * User collection: organizations have no per-user subscription fields.
 *
 * BILLING_SECURITY: reads only Subscription (billing) + writes only OrgUsage.
 */
export async function syncOrgSubscriptionState(args: {
  orgId: string;
  subscriptionDocId?: mongoose.Types.ObjectId | string | null;
  status: OrgSubscriptionStatus;
  expiresAt?: Date | null;
  autopayActive?: boolean;
  gracePeriod?: { active: boolean; endsAt: Date | null };
  /** Purchased seats (Razorpay subscription quantity). Ignored when absent. */
  seats?: number | null;
}) {
  await dbConnect();

  const expiresAt = args.expiresAt ?? null;
  const usageUpdate: Record<string, unknown> = {
    accountId: orgStorageOwnerId(args.orgId),
    autopayActive: args.autopayActive ?? args.status === "active",
  };

  if (expiresAt) {
    const subscription = args.subscriptionDocId
      ? await Subscription.findById(args.subscriptionDocId).lean()
      : null;
    const planSlug = subscription?.planSlug || ORG_FREE_PLAN_SLUG;
    const plan = getOrgPlanBySlug(planSlug);

    usageUpdate.plan = planSlug;
    usageUpdate.planActivatedAt = subscription?.startDate || new Date();
    usageUpdate.planExpiresAt = expiresAt;

    const basePaise =
      typeof subscription?.metadata?.basePlanAmount === "number"
        ? subscription.metadata.basePlanAmount
        : Number(subscription?.metadata?.basePlanAmount) || 0;
    usageUpdate.planPriceINR = basePaise / 100;
    usageUpdate.basePlanPriceINR = basePaise / 100;

    usageUpdate.storageLimitBytes = plan
      ? plan.storageLimitBytes
      : ORG_FREE_TIER_LIMIT_BYTES;
  }

  if (typeof args.seats === "number" && args.seats > 0) {
    usageUpdate.seats = args.seats;
  }

  if (args.gracePeriod) {
    usageUpdate.isGracePeriod = args.gracePeriod.active;
    usageUpdate.gracePeriodEndsAt = args.gracePeriod.endsAt;
  } else if (expiresAt) {
    usageUpdate.isGracePeriod = false;
    usageUpdate.gracePeriodEndsAt = null;
  }

  // Immediate cancellation (no remaining paid period) drops the org to free.
  if (args.status === "cancelled" && !expiresAt) {
    usageUpdate.plan = ORG_FREE_PLAN_SLUG;
    usageUpdate.storageLimitBytes = ORG_FREE_TIER_LIMIT_BYTES;
    usageUpdate.seats = ORG_FREE_SEATS;
    usageUpdate.autopayActive = false;
  }

  await OrgUsage.findOneAndUpdate(
    { orgId: args.orgId },
    { $set: usageUpdate },
    { upsert: true, setDefaultsOnInsert: true },
  );
}

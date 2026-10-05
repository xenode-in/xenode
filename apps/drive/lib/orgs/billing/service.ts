import mongoose from "mongoose";
import dbConnect from "@/lib/mongodb";
import Subscription from "@/models/Subscription";
import OrgUsage, {
  ORG_FREE_SEATS,
  ORG_FREE_TIER_LIMIT_BYTES,
} from "@/models/OrgUsage";
import { orgStorageOwnerId } from "@/lib/orgs/storage";
import { getOrgPlanBySlug, ORG_FREE_PLAN_SLUG } from "./orgPlans";
import { withTransaction } from "@xenode/database";
import type { StorageRegion } from "@xenode/config/storage";
import { BillingError } from "@/lib/billing/http";
import { emitBillingEvent, type EmitArgs } from "@/lib/billing/events";
import { SUBSCRIPTION_GRACE_PERIOD_MS } from "@/lib/subscriptions/constants";
import SubscriptionInvoice from "@/models/SubscriptionInvoice";

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
type OrgStateCommand = {
  orgId: string;
  session?: mongoose.ClientSession;
  actor?: Pick<EmitArgs, "actorType" | "actorId">;
} & (
  | { action?: "subscription"; subscriptionDocId?: mongoose.Types.ObjectId | string | null;
      status: OrgSubscriptionStatus; expiresAt?: Date | null; autopayActive?: boolean;
      gracePeriod?: { active: boolean; endsAt: Date | null }; seats?: number | null;
      renewal?: { invoiceId: string } }
  | { action: "initialize"; storageRegion: StorageRegion }
  | { action: "refund"; subscriptionDocId: mongoose.Types.ObjectId | string }
  | { action: "expire"; now: Date }
);

function freeEntitlement() {
  return { subscriptionDocId: null, plan: ORG_FREE_PLAN_SLUG, storageLimitBytes: ORG_FREE_TIER_LIMIT_BYTES,
    seats: ORG_FREE_SEATS, planActivatedAt: null, planExpiresAt: null, planPriceINR: 0,
    basePlanPriceINR: 0, autopayActive: false, isGracePeriod: false, gracePeriodEndsAt: null };
}

export async function syncOrgSubscriptionState(args: OrgStateCommand) {
  await dbConnect();
  await OrgUsage.init();
  const apply = async (session: mongoose.ClientSession) => {
    const current = await OrgUsage.findOne({ orgId: args.orgId }).session(session);
    if (args.action === "initialize" && current) {
      if (current.storageRegion && current.storageRegion !== args.storageRegion) {
        throw new BillingError(409, "Organization storage pool is locked", "storage_pool_locked");
      }
      return { usage: current, outcome: "unchanged" };
    }
    if (args.action === "expire" && (!current || current.plan === ORG_FREE_PLAN_SLUG ||
      !current.planExpiresAt || current.planExpiresAt > args.now)) {
      return { usage: current, outcome: "unchanged" };
    }
    const subscription = "subscriptionDocId" in args && args.subscriptionDocId
      ? await Subscription.findById(args.subscriptionDocId).session(session) : null;
    if ("subscriptionDocId" in args && args.subscriptionDocId &&
      (!subscription || subscription.accountId !== orgStorageOwnerId(args.orgId))) {
      throw new BillingError(409, "Subscription belongs to a different billing account", "subscription_scope");
    }
    if (args.action === "refund" && String(current?.subscriptionDocId) !== String(subscription?._id)) {
      return { usage: current, outcome: "unchanged" };
    }
    if ((args.action === undefined || args.action === "subscription") && subscription) {
      if (subscription.metadata?.entitlementRevokedAt) return { usage: current, outcome: "unchanged" };
      if (current?.subscriptionDocId && String(current.subscriptionDocId) !== String(subscription._id)) {
        const bound = await Subscription.findById(current.subscriptionDocId).session(session);
        if (bound && (bound.createdAt > subscription.createdAt ||
          (bound.createdAt.getTime() === subscription.createdAt.getTime() && String(bound._id) > String(subscription._id)))) {
          return { usage: current, outcome: "unchanged" };
        }
      }
      if (args.renewal) {
        const invoice = await SubscriptionInvoice.findById(args.renewal.invoiceId).session(session);
        if (!invoice || invoice.subscription_id !== subscription.subscription_id) {
          throw new BillingError(409, "Renewal invoice belongs to a different subscription", "invoice_scope");
        }
        if (invoice.usageAppliedAt) return { usage: current, outcome: "unchanged" };
      }
    }

    let outcome = "synced";
    let update: Record<string, unknown> = {};
    if (args.action === "initialize") {
      update = { ...freeEntitlement(), storageRegion: args.storageRegion };
      outcome = "initialized";
    } else if (args.action === "refund") {
      update = freeEntitlement();
      outcome = "refunded";
    } else if (args.action === "expire") {
      const usage = current!;
      const deadline = usage.isGracePeriod && usage.gracePeriodEndsAt ? usage.gracePeriodEndsAt
        : new Date(usage.planExpiresAt!.getTime() + SUBSCRIPTION_GRACE_PERIOD_MS);
      if (deadline > args.now) {
        update = { isGracePeriod: true, gracePeriodEndsAt: deadline };
        outcome = "grace";
      } else {
        update = freeEntitlement();
        outcome = "expired";
        await Subscription.updateMany({ accountId: orgStorageOwnerId(args.orgId),
          status: { $in: ["active", "paused", "pending", "past_due", "halted"] },
          endDate: { $lte: usage.planExpiresAt } },
        { $set: { status: "expired", autoRenew: false } }, { session });
      }
    } else {
      const expiresAt = args.expiresAt ?? null;
      if (subscription && expiresAt) {
        const plan = getOrgPlanBySlug(subscription.planSlug);
        if (!plan) throw new BillingError(409, "Organization plan is not configured", "invalid_plan");
        const basePaise = Number(subscription.metadata?.basePlanAmount) || 0;
        update = { subscriptionDocId: subscription._id, plan: subscription.planSlug,
          planActivatedAt: subscription.startDate, planExpiresAt: expiresAt,
          planPriceINR: basePaise / 100, basePlanPriceINR: basePaise / 100,
          storageLimitBytes: plan.storageLimitBytes, autopayActive: args.autopayActive ?? args.status === "active",
          isGracePeriod: false, gracePeriodEndsAt: null };
        if (args.seats != null) {
          if (!Number.isSafeInteger(args.seats) || args.seats < 1) {
            throw new BillingError(400, "Seats must be a positive integer", "invalid_seats");
          }
          update.seats = args.seats;
        }
      } else if (args.status === "cancelled" || args.status === "none") {
        update = freeEntitlement();
      } else throw new BillingError(409, "Paid state requires a subscription and period", "subscription_missing");
      if (args.gracePeriod) {
        update.isGracePeriod = args.gracePeriod.active;
        update.gracePeriodEndsAt = args.gracePeriod.active && current?.isGracePeriod &&
          current.gracePeriodEndsAt && current.planExpiresAt?.getTime() === expiresAt?.getTime()
          ? current.gracePeriodEndsAt : args.gracePeriod.endsAt;
      }
      if (args.renewal) {
        const invoice = await SubscriptionInvoice.findById(args.renewal.invoiceId).session(session);
        if (!invoice || invoice.subscription_id !== subscription?.subscription_id) {
          throw new BillingError(409, "Renewal invoice belongs to a different subscription", "invoice_scope");
        }
        if (!invoice.usageAppliedAt) {
          invoice.usageAppliedAt = new Date();
          await invoice.save({ session });
        }
      }
    }
    const before = current?.toObject() as Record<string, unknown> | undefined;
    const changed = Object.entries(update).some(([key, value]) => JSON.stringify(before?.[key]) !== JSON.stringify(value));
    const usage = await OrgUsage.findOneAndUpdate({ orgId: args.orgId },
      { $set: { accountId: orgStorageOwnerId(args.orgId), ...update } },
      { upsert: true, new: true, runValidators: true, session });
    if (changed) await emitBillingEvent({
      type: "org.entitlement.changed", actorType: args.actor?.actorType ?? "system",
      actorId: args.actor?.actorId ?? null, subjectType: "organization", subjectId: args.orgId,
      payload: { action: args.action ?? "subscription", outcome, previousPlan: current?.plan ?? null,
        plan: usage.plan, storageLimitBytes: usage.storageLimitBytes, seats: usage.seats, expiresAt: usage.planExpiresAt },
    }, session);
    return { usage, outcome };
  };

  return args.session ? apply(args.session) : withTransaction(apply);
}
